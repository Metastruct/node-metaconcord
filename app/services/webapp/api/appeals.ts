import * as Discord from "discord.js";
import type { Response } from "express";
import { resolveProfiles, toEntry } from "./bans.js";
import { EMBED_FIELD_LIMIT } from "@/app/services/discord/index.js";
import { MetaBan, PERMANENT_UNBAN_TIME } from "@/app/services/Bans.js";
import { SteamSession, getSteamSession } from "./auth/steam.js";
import { actorLabel } from "@/app/services/gamebridge/games/gmod/banActor.js";
import { pickGmodServer, revokeBan } from "@/app/services/gamebridge/games/gmod/banActions.js";
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
	resolution: "unbanned" | "refused" | null;
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
					closed_at INTEGER,
					resolution TEXT
				);
				CREATE INDEX IF NOT EXISTS appeals_steam ON appeals(steam_id64);
				CREATE UNIQUE INDEX IF NOT EXISTS appeals_open
					ON appeals(steam_id64, banned_at) WHERE closed_at IS NULL;`
			)
			// tables created before the buttons existed lack the column
			.then(() =>
				database.exec("ALTER TABLE appeals ADD COLUMN resolution TEXT;").catch(() => {})
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

	const closeAppeals = async (
		steamId64: string,
		resolution?: AppealRow["resolution"]
	): Promise<void> => {
		await (
			await db()
		).run(
			"UPDATE appeals SET closed_at = ?, resolution = ? WHERE steam_id64 = ? AND closed_at IS NULL;",
			Math.round(Date.now() / 1000),
			resolution ?? null,
			steamId64
		);
	};

	const closeAppealRow = async (
		id: number,
		resolution?: AppealRow["resolution"]
	): Promise<void> => {
		await (
			await db()
		).run(
			"UPDATE appeals SET closed_at = ?, resolution = ? WHERE id = ? AND closed_at IS NULL;",
			Math.round(Date.now() / 1000),
			resolution ?? null,
			id
		);
	};

	const rowById = async (id: number): Promise<AppealRow | undefined> =>
		(await db()).get<AppealRow>("SELECT * FROM appeals WHERE id = ?;", id);

	/** The most recent appeal for one specific ban, open or resolved. */
	const rowForBan = async (steamId64: string, bannedAt: number): Promise<AppealRow | undefined> =>
		(await db()).get<AppealRow>(
			"SELECT * FROM appeals WHERE steam_id64 = ? AND banned_at = ? ORDER BY id DESC LIMIT 1;",
			steamId64,
			bannedAt
		);

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
		const row = await rowForBan(session.steamId64, ban.whenbanned);
		if (row && !row.closed_at) {
			res.json({
				status: "appealed",
				ban: entry,
				profiles,
				appeal: { id: row.id, createdAt: row.created_at },
			});
			return;
		}
		if (row?.resolution === "refused") {
			res.json({
				status: "refused",
				ban: entry,
				profiles,
				appeal: { id: row.id, createdAt: row.created_at },
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

		// one shot per ban: a refused appeal stays refused
		const settled = await rowForBan(session.steamId64, ban.whenbanned);
		if (settled?.resolution === "refused") {
			res.status(409).json({ error: "your appeal was refused" });
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

		const buttons = new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
			new Discord.ButtonBuilder()
				.setStyle(Discord.ButtonStyle.Success)
				.setCustomId(`${session.steamId64}_APPEAL_UNBAN`)
				.setEmoji("🔓")
				.setLabel("Unban"),
			new Discord.ButtonBuilder()
				.setStyle(Discord.ButtonStyle.Danger)
				.setCustomId(`${session.steamId64}_APPEAL_REFUSE`)
				.setEmoji("🚫")
				.setLabel("Refuse appeal")
		);

		let thread: Discord.ThreadChannel;
		let starterId: string;
		try {
			const sentMsg = await channel.send({ embeds: [embed], components: [buttons] });
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
		const inserted = await (
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
		res.status(201).json({ status: "appealed", appeal: { id: inserted.lastID, createdAt } });
	});

	/**
	 * The chat endpoints name the appeal by id, so a tab still showing an older appeal can
	 * never silently read or write a newer appeal's thread; it gets told the one it is
	 * looking at is over instead.
	 */
	const appealFromParam = async (
		req: Request,
		res: Response,
		session: SteamSession
	): Promise<AppealRow | undefined> => {
		const id = Number(req.params.id);
		const row = Number.isInteger(id) && id > 0 ? await rowById(id) : undefined;
		if (!row || row.steam_id64 !== session.steamId64) {
			res.status(404).json({ error: "no such appeal" });
			return undefined;
		}
		return row;
	};

	webApp.app.get("/appeals/:id/messages", messagesLimiter, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		res.set("Cache-Control", "no-store");
		const row = await appealFromParam(req, res, session);
		if (!row) return;
		// a moot or accepted appeal has nothing left to show, only refused ones stay readable
		if (row.closed_at && row.resolution !== "refused") {
			res.json({ closed: true, messages: [] });
			return;
		}

		const cached = messagesCache.get(row.thread_id);
		if (cached && Date.now() - cached.at < MESSAGES_CACHE_MS) {
			res.json({ messages: cached.messages });
			return;
		}

		const thread = await fetchThread(row);
		if (thread === "gone") {
			// deletions the bot slept through end up here
			if (!row.closed_at) await refuseIfUnresolved(row);
			res.json({ closed: true, messages: [] });
			return;
		}
		if (!thread) {
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}
		if (!row.closed_at && thread.locked) {
			// same for locks
			await refuseIfUnresolved(row);
			res.json({ closed: true, messages: [] });
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

	webApp.app.post("/appeals/:id/messages", replyLimiter, json, async (req, res) => {
		const session = requireSteam(req, res);
		if (!session) return;

		const content = cleanText(req.body?.message, REPLY_MAX);
		if (!content) {
			res.status(400).json({ error: "message is required" });
			return;
		}

		const row = await appealFromParam(req, res, session);
		if (!row) return;
		if (row.closed_at) {
			res.status(409).json({ error: "this appeal was closed" });
			return;
		}

		const thread = await fetchThread(row);
		if (thread === "gone") {
			await refuseIfUnresolved(row);
			res.status(409).json({ error: "this appeal was closed" });
			return;
		}
		if (!thread) {
			res.status(503).json({ error: "Discord is unavailable right now" });
			return;
		}
		if (thread.locked) {
			await refuseIfUnresolved(row);
			res.status(409).json({ error: "this appeal was closed" });
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

	// --- the Unban / Refuse buttons on the appeal embeds ---

	// WebApp is constructed before DiscordBot (see services/index.ts), so the service can
	// only be looked up lazily, never while this module registers
	const bot = () => webApp.container.getService("DiscordBot");

	const isDeveloper = async (userId: string): Promise<boolean> => {
		const member = await bot().getGuildMember(userId);
		if (!member) return false;
		const { administrator, developer, newDeveloper } = bot().config.roles;
		return [administrator, developer, newDeveloper].some(id => member.roles.cache.has(id));
	};

	/** Swaps the two buttons for a single disabled one showing how it ended. */
	const settleButtons = async (
		msg: Discord.Message,
		label: string,
		style: Discord.ButtonStyle
	): Promise<void> => {
		const settled = new Discord.ButtonBuilder()
			.setStyle(style)
			.setCustomId(`${msg.id}_APPEAL_SETTLED`)
			.setLabel(label)
			.setDisabled(true);
		await msg.edit({
			components: [
				new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(settled),
			],
		});
	};

	const archiveThread = async (thread: Discord.ThreadChannel | null): Promise<void> => {
		if (!thread) return;
		messagesCache.delete(thread.id);
		try {
			await thread.setLocked(true);
			await thread.setArchived(true);
		} catch (err) {
			log.error(err, `failed archiving appeal thread ${thread.id}`);
		}
	};

	const openAppealByThread = async (threadId: string): Promise<AppealRow | undefined> =>
		(await db()).get<AppealRow>(
			"SELECT * FROM appeals WHERE thread_id = ? AND closed_at IS NULL LIMIT 1;",
			threadId
		);

	const openAppealByMessage = async (messageId: string): Promise<AppealRow | undefined> =>
		(await db()).get<AppealRow>(
			"SELECT * FROM appeals WHERE message_id = ? AND closed_at IS NULL LIMIT 1;",
			messageId
		);

	const settleStarter = async (
		row: AppealRow,
		label: string,
		style: Discord.ButtonStyle
	): Promise<void> => {
		try {
			const channel = bot().getTextChannel(bot().config.channels.appeals);
			if (!channel) return;
			await settleButtons(await channel.messages.fetch(row.message_id), label, style);
		} catch (err) {
			log.error(err, `failed settling appeal message ${row.message_id}`);
		}
	};

	/**
	 * Locking, closing or deleting an appeal thread by hand counts as refusing the appeal,
	 * as long as the ban is still active; a lifted or expired ban just closes it as moot.
	 */
	const refuseIfUnresolved = async (row: AppealRow): Promise<void> => {
		const ban = await webApp.container
			.getService("Bans")
			.getBan(row.steam_id64)
			.catch(() => undefined);
		const refused = !!ban && isActive(ban);
		await closeAppealRow(row.id, refused ? "refused" : undefined);
		messagesCache.delete(row.thread_id);
		if (refused) await settleStarter(row, "Refused", Discord.ButtonStyle.Danger);
		log.info(
			`appeal thread ${row.thread_id} of ${row.steam_id64} was closed on Discord, ` +
				(refused ? "appeal refused" : "ban no longer active")
		);
	};

	/**
	 * "Close Thread" in Discord is just archiving, which the week of inactivity also does on
	 * its own; only a person's archive should refuse. The audit log tells them apart, and
	 * with no access to it a person is assumed.
	 */
	const wasManuallyArchived = async (thread: Discord.ThreadChannel): Promise<boolean> => {
		try {
			const logs = await thread.guild.fetchAuditLogs({
				type: Discord.AuditLogEvent.ThreadUpdate,
				limit: 10,
			});
			return logs.entries.some(
				entry =>
					entry.targetId === thread.id &&
					Date.now() - entry.createdTimestamp < 60_000 &&
					entry.changes.some(change => change.key === "archived" && change.new === true)
			);
		} catch {
			return true;
		}
	};

	// deferred so the listeners attach once the container holds every service
	setImmediate(() => {
		bot().discord.on("threadDelete", async thread => {
			if (thread.parentId !== bot().config.channels.appeals) return;
			const row = await openAppealByThread(thread.id);
			if (row) await refuseIfUnresolved(row);
		});

		bot().discord.on("threadUpdate", async (oldThread, newThread) => {
			if (newThread.parentId !== bot().config.channels.appeals) return;
			const lockedNow = !oldThread.locked && newThread.locked;
			const archivedNow = !oldThread.archived && newThread.archived;
			if (!lockedNow && !archivedNow) return;
			// the button flow closes the row before archiving, so it never lands here
			const row = await openAppealByThread(newThread.id);
			if (!row) return;
			if (!lockedNow && archivedNow && !(await wasManuallyArchived(newThread))) return;
			await refuseIfUnresolved(row);
		});

		bot().discord.on("interactionCreate", async interaction => {
			if (!interaction.isButton()) return;
			const isUnban = interaction.customId.endsWith("_APPEAL_UNBAN");
			const isRefuse = interaction.customId.endsWith("_APPEAL_REFUSE");
			if (!isUnban && !isRefuse) return;

			// acknowledged first thing: the permission check can involve a member fetch,
			// and Discord voids the interaction 3 seconds after the click
			try {
				await interaction.deferUpdate();
			} catch (err) {
				log.warn(err, "could not acknowledge an appeal button in time");
				return;
			}

			if (!(await isDeveloper(interaction.user.id))) {
				await interaction.followUp({
					content: "you're not allowed to use this button...",
					flags: Discord.MessageFlags.Ephemeral,
				});
				return;
			}

			// the buttons act on the appeal this embed belongs to, never on whatever the
			// player's latest appeal happens to be
			const row = await openAppealByMessage(interaction.message.id);
			if (!row) {
				await interaction.followUp({
					content: "this appeal is already settled.",
					flags: Discord.MessageFlags.Ephemeral,
				});
				return;
			}
			const steamId64 = row.steam_id64;
			const thread = interaction.message.thread;

			if (isRefuse) {
				await closeAppealRow(row.id, "refused");
				await thread?.send({ content: `🚫 ${interaction.user} refused the appeal.` });
				await settleButtons(interaction.message, "Refused", Discord.ButtonStyle.Danger);
				await archiveThread(thread);
				log.info(`${interaction.user.username} refused the appeal of ${steamId64}`);
				return;
			}

			const bans = webApp.container.getService("Bans");
			const ban = await bans.getBan(steamId64);
			if (ban && isActive(ban)) {
				const server = pickGmodServer(webApp.container.getService("GameBridge"));
				if (!server) {
					await thread?.send({
						content: `${interaction.user}, could not unban: no game server is connected right now.`,
					});
					return;
				}
				const ok = await revokeBan(
					server,
					{
						steamId: ban.sid,
						actor: `Discord (${interaction.user.username}|${interaction.user})`,
						reason: "Appeal accepted",
					},
					interaction.user.username
				);
				if (!ok) {
					await thread?.send({
						content: `${interaction.user}, could not unban: the game server ${
							ok === undefined ? "did not answer" : "refused the unban"
						}.`,
					});
					return;
				}
				await bans.updateCache(true).catch(() => {});
			}

			await closeAppealRow(row.id, "unbanned");
			await thread?.send({
				content: `🔓 ${interaction.user} accepted the appeal and unbanned the player.`,
			});
			await settleButtons(interaction.message, "Unbanned", Discord.ButtonStyle.Success);
			await archiveThread(thread);
			log.info(`${interaction.user.username} accepted the appeal of ${steamId64}, unbanned`);
		});
	});
};
