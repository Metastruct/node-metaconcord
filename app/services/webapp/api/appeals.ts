import * as Discord from "discord.js";
import type { Response } from "express";
import { resolveProfiles, toEntry } from "./bans.js";
import { EMBED_FIELD_LIMIT } from "@/app/services/discord/index.js";
import { MetaBan, PERMANENT_UNBAN_TIME } from "@/app/services/Bans.js";
import { SteamSession, getSteamSession } from "./auth/steam.js";
import { actorLabel } from "@/app/services/gamebridge/games/gmod/banActor.js";
import { f, logger } from "@/utils.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import express, { Request } from "express";
import { WebApp } from "@/app/services/webapp/index.js";

const log = logger(import.meta);

/**
 * Web ban appeals. A banned player logs in with Steam (see auth/steam), submits an appeal
 * which opens a thread in the appeals channel, and the thread then works as a two way chat:
 * staff talk in Discord, the appellant reads and replies from the website. The thread is the
 * conversation, sqlite only remembers which thread belongs to which ban.
 */

const APPEAL_MIN = 10;
const APPEAL_MAX = 1900;
const REPLY_MAX = 1500;
const NAME_MAX = 64;
const MESSAGES_CACHE_MS = 10_000;
const RELAY_RE = /^\*\*(.+?)\*\*: /s;

// keep newlines, appeals are prose; everything else that ends up in Discord content
// gets control characters stripped
// eslint-disable-next-line no-control-regex -- matching control bytes is the point
const TEXT_CONTROL_RE = new RegExp("[\\u0000-\\u0009\\u000b-\\u001f\\u007f]", "g");
const cleanText = (value: unknown, max: number): string =>
	typeof value === "string" ? value.replace(TEXT_CONTROL_RE, "").trim().slice(0, max) : "";

type AppealRow = {
	id: number;
	steam_id64: string;
	banned_at: number;
	thread_id: string;
	message_id: string;
	created_at: number;
	closed_at: number | null;
};

type AppealMessage = {
	id: string;
	author: string;
	isYou: boolean;
	content: string;
	createdAt: number;
};

const isActive = (ban: MetaBan): boolean =>
	ban.b &&
	(ban.whenunban === PERMANENT_UNBAN_TIME || ban.whenunban > Math.round(Date.now() / 1000));

/** Markdown-significant characters stripped so a persona name cannot fake the relay prefix. */
const safeName = (session: SteamSession): string =>
	cleanText(session.name, NAME_MAX)
		.replace(/[*_~`|\\]/g, "")
		.trim() || session.steamId64;

const sanitizeForWeb = (msg: Discord.Message): string => {
	let content = msg.cleanContent ?? msg.content ?? "";
	content = content.replace(/<a?:([^\s:<>]*):\d+>/g, (_, name) => `:${name}:`);
	for (const [, attachment] of msg.attachments) {
		content += (content.length > 0 ? "\n" : "") + attachment.url;
	}
	if (content.length === 0) content = msg.embeds.length > 0 ? "[Embed]" : "[Something]";
	return content;
};

const toAppealMessage = (msg: Discord.Message, botId?: string): AppealMessage | undefined => {
	if (msg.system) return undefined;
	if (msg.author.id === botId) {
		// the bot only writes relayed appellant messages and housekeeping notes in
		// these threads, everything not shaped like a relay stays Discord-only
		const relay = RELAY_RE.exec(msg.content);
		if (!relay) return undefined;
		return {
			id: msg.id,
			author: relay[1],
			isYou: true,
			content: sanitizeForWeb(msg).replace(RELAY_RE, ""),
			createdAt: Math.round(msg.createdTimestamp / 1000),
		};
	}
	if (msg.author.bot) return undefined;
	return {
		id: msg.id,
		author: msg.member?.displayName ?? msg.author.username,
		isYou: false,
		content: sanitizeForWeb(msg),
		createdAt: Math.round(msg.createdTimestamp / 1000),
	};
};

export default (webApp: WebApp): void => {
	const sql = webApp.container.getService("SQL");
	const json = express.json({ limit: "8kb" });
	const statusLimiter = rateLimit({
		keyGenerator: rateLimitKeyGenerator,
		windowMs: 60_000,
		limit: 30,
	});
	const submitLimiter = rateLimit({
		keyGenerator: rateLimitKeyGenerator,
		windowMs: 10 * 60_000,
		limit: 3,
	});
	const messagesLimiter = rateLimit({
		keyGenerator: rateLimitKeyGenerator,
		windowMs: 60_000,
		limit: 20,
	});
	const replyLimiter = rateLimit({
		keyGenerator: rateLimitKeyGenerator,
		windowMs: 60_000,
		limit: 10,
	});
	const messagesCache = new Map<string, { at: number; messages: AppealMessage[] }>();

	let tableReady: Promise<void> | undefined;
	const db = async () => {
		const database = sql.getLocalDatabase();
		tableReady ??= database
			.exec(
				`CREATE TABLE IF NOT EXISTS appeals (
					id INTEGER PRIMARY KEY AUTOINCREMENT,
					steam_id64 TEXT NOT NULL,
					banned_at INTEGER NOT NULL,
					thread_id TEXT NOT NULL,
					message_id TEXT NOT NULL,
					created_at INTEGER NOT NULL,
					closed_at INTEGER
				);
				CREATE INDEX IF NOT EXISTS appeals_steam ON appeals(steam_id64);
				CREATE UNIQUE INDEX IF NOT EXISTS appeals_open
					ON appeals(steam_id64, banned_at) WHERE closed_at IS NULL;`
			)
			.then(() => undefined);
		await tableReady;
		return database;
	};

	const requireSteam = (req: Request, res: Response): SteamSession | undefined => {
		const session = getSteamSession(req);
		if (!session) res.status(401).json({ error: "not logged in" });
		return session;
	};

	const openAppeal = async (steamId64: string): Promise<AppealRow | undefined> =>
		(await db()).get<AppealRow>(
			"SELECT * FROM appeals WHERE steam_id64 = ? AND closed_at IS NULL ORDER BY id DESC LIMIT 1;",
			steamId64
		);

	const closeAppeals = async (steamId64: string): Promise<void> => {
		await (
			await db()
		).run(
			"UPDATE appeals SET closed_at = ? WHERE steam_id64 = ? AND closed_at IS NULL;",
			Math.round(Date.now() / 1000),
			steamId64
		);
	};

	/** The appeal thread, or "gone" when it was deleted on the Discord side. */
	const fetchThread = async (
		row: AppealRow
	): Promise<Discord.ThreadChannel | "gone" | undefined> => {
		const bot = webApp.container.getService("DiscordBot");
		const guild = bot.getGuild();
		if (!guild) return undefined;
		try {
			const channel = await guild.channels.fetch(row.thread_id);
			if (!channel?.isThread()) return "gone";
			return channel;
		} catch (err) {
			if (err instanceof Discord.DiscordAPIError && err.code === 10003) return "gone";
			log.error(err, `failed fetching appeal thread ${row.thread_id}`);
			return undefined;
		}
	};

	webApp.app.get("/appeals/me", statusLimiter, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		const bans = webApp.container.getService("Bans");
		if (bans.getStatus().updatedAt === 0) {
			res.status(502).json({ error: "the ban list is unavailable right now" });
			return;
		}

		res.set("Cache-Control", "no-store");
		const ban = await bans.getBan(session.steamId64);
		if (!ban) {
			res.json({ status: "not_banned" });
			return;
		}
		if (!isActive(ban)) {
			// their ban is over, whatever appeal was open is moot
			await closeAppeals(session.steamId64);
			res.json({ status: "unbanned" });
			return;
		}

		const entry = toEntry(ban);
		const profiles = await resolveProfiles(webApp, [entry]);
		const row = await openAppeal(session.steamId64);
		if (row && row.banned_at === ban.whenbanned) {
			res.json({
				status: "appealed",
				ban: entry,
				profiles,
				appeal: { createdAt: row.created_at },
			});
			return;
		}
		res.json({ status: "banned", ban: entry, profiles });
	});

	webApp.app.post("/appeals", submitLimiter, json, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		const message = cleanText(req.body?.message, APPEAL_MAX);
		if (message.length < APPEAL_MIN) {
			res.status(400).json({
				error: "please write a few words about why you should be unbanned",
			});
			return;
		}

		const bans = webApp.container.getService("Bans");
		const ban = await bans.getBan(session.steamId64);
		if (!ban || !isActive(ban)) {
			res.status(409).json({ error: "you are not banned" });
			return;
		}

		// an appeal left over from an older ban does not block appealing the current one
		const previous = await openAppeal(session.steamId64);
		if (previous && previous.banned_at !== ban.whenbanned) {
			await closeAppeals(session.steamId64);
		} else if (previous) {
			res.status(409).json({ error: "you already have an open appeal" });
			return;
		}

		const bot = webApp.container.getService("DiscordBot");
		const channel = bot.getTextChannel(bot.config.channels.appeals);
		if (!channel) {
			res.status(503).json({ error: "appeals are unavailable right now" });
			return;
		}

		const entry = toEntry(ban);
		const name = safeName(session);
		const embed = new Discord.EmbedBuilder();
		if (session.avatar) embed.setThumbnail(session.avatar);
		embed.setAuthor({
			name: `${name} appealed their ban`,
			iconURL: session.avatar || undefined,
			url: `https://steamcommunity.com/profiles/${session.steamId64}`,
		});
		embed.addFields(f("Nick", entry.name || name, true));
		embed.addFields(f("Banned by", actorLabel(entry.bannedBy), true));
		embed.addFields(f("Ban Reason", entry.reason.substring(0, EMBED_FIELD_LIMIT), true));
		embed.addFields(
			f("Ban Expiration", entry.permanent ? "Permanent" : `<t:${entry.unbanAt}:R>`, true)
		);
		embed.addFields(
			f("Appeal", `\`\`\`${message.substring(0, 1000).replaceAll("```", "​`​`​`")}\`\`\``)
		);
		embed.addFields(
			f(
				"SteamID",
				`[${session.steamId64}](https://steamcommunity.com/profiles/${session.steamId64}) (${entry.steamId})`
			)
		);

		let thread: Discord.ThreadChannel;
		let starterId: string;
		try {
			const sentMsg = await channel.send({ embeds: [embed] });
			starterId = sentMsg.id;
			thread = await sentMsg.startThread({
				name: `Appeal - ${name} (${session.steamId64})`.slice(0, 100),
				autoArchiveDuration: Discord.ThreadAutoArchiveDuration.OneWeek,
			});
			// the full appeal text opens the conversation, the embed only carries a preview
			await thread.send({
				content: `**${name}**: ${message}`,
				allowedMentions: { parse: [] },
			});
			const discordId = await webApp.container
				.getService("DiscordMetadata")
				.discordIDfromSteam64(session.steamId64)
				.catch(() => undefined);
			if (discordId) {
				await thread.send({
					content: `Linked Discord account: <@${discordId}>`,
					allowedMentions: { users: [discordId] },
				});
			}
		} catch (err) {
			log.error(err, "failed creating appeal thread");
			res.status(503).json({ error: "appeals are unavailable right now" });
			return;
		}

		const createdAt = Math.round(Date.now() / 1000);
		await (
			await db()
		).run(
			"INSERT INTO appeals (steam_id64, banned_at, thread_id, message_id, created_at) VALUES (?, ?, ?, ?, ?);",
			session.steamId64,
			ban.whenbanned,
			thread.id,
			starterId,
			createdAt
		);

		log.info(`${session.steamId64} (${name}) appealed their ban, thread ${thread.id}`);
		res.status(201).json({ status: "appealed", appeal: { createdAt } });
	});

	webApp.app.get("/appeals/me/messages", messagesLimiter, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		res.set("Cache-Control", "no-store");
		const row = await openAppeal(session.steamId64);
		if (!row) {
			res.status(404).json({ error: "no open appeal" });
			return;
		}

		const cached = messagesCache.get(row.thread_id);
		if (cached && Date.now() - cached.at < MESSAGES_CACHE_MS) {
			res.json({ messages: cached.messages });
			return;
		}

		const thread = await fetchThread(row);
		if (thread === "gone") {
			await closeAppeals(session.steamId64);
			res.json({ closed: true, messages: [] });
			return;
		}
		if (!thread) {
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}

		const botId = webApp.container.getService("DiscordBot").discord.user?.id;
		const fetched = await thread.messages.fetch({ limit: 100 }).catch(() => undefined);
		if (!fetched) {
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}
		const messages = [...fetched.values()]
			.sort((a, b) => a.createdTimestamp - b.createdTimestamp)
			.map(msg => toAppealMessage(msg, botId))
			.filter((msg): msg is AppealMessage => !!msg);

		messagesCache.set(row.thread_id, { at: Date.now(), messages });
		res.json({ messages });
	});

	webApp.app.post("/appeals/me/messages", replyLimiter, json, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		const content = cleanText(req.body?.message, REPLY_MAX);
		if (!content) {
			res.status(400).json({ error: "message is required" });
			return;
		}

		const row = await openAppeal(session.steamId64);
		if (!row) {
			res.status(404).json({ error: "no open appeal" });
			return;
		}

		const thread = await fetchThread(row);
		if (thread === "gone") {
			await closeAppeals(session.steamId64);
			res.status(409).json({ error: "this appeal was closed" });
			return;
		}
		if (!thread) {
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}

		const name = safeName(session);
		try {
			if (thread.archived) await thread.setArchived(false);
			await thread.send({
				content: `**${name}**: ${content}`,
				allowedMentions: { parse: [] },
			});
		} catch (err) {
			log.error(err, `failed relaying appeal message to thread ${row.thread_id}`);
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}

		messagesCache.delete(row.thread_id);
		res.status(201).json({
			message: {
				id: "",
				author: name,
				isYou: true,
				content,
				createdAt: Math.round(Date.now() / 1000),
			},
		});
	});
};
