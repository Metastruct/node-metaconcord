import type { Request, Response } from "express";
import {
	BanActor,
	githubActor,
	HARDBAN_ACTOR,
	parseBanActor,
} from "@/app/services/gamebridge/games/gmod/banActor.js";
import { getSession, isTeamMember } from "./auth/github.js";
import {
	issueBan,
	pickGmodServer,
	revokeBan,
} from "@/app/services/gamebridge/games/gmod/banActions.js";
import { MetaBan, PERMANENT_UNBAN_TIME } from "@/app/services/Bans.js";
import { logger, parseDuration } from "@/utils.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import express from "express";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import SteamID from "steamid";
import { WebApp } from "@/app/services/webapp/index.js";

const log = logger(import.meta);

/**
 * The ban list that used to live at banni.metastruct.net. The data itself belongs to the
 * banni addon on the game server, metaconcord only caches it (see services/Bans), so writes
 * here run Lua on a connected gmod server and then force a cache refresh.
 */

const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=240";
const MAX_BAN_LENGTH = 10 * 365 * 24 * 60 * 60;
const REASON_MAX = 500;
const NICK_MAX = 64;
const GAMEMODE_RE = /^[a-z0-9_]{1,32}$/i;
// control characters are stripped from anything that ends up in generated Lua
// eslint-disable-next-line no-control-regex -- matching control bytes is the point
const CONTROL_RE = new RegExp("[\\u0000-\\u001f\\u007f]", "g");

type Profile = { name: string; avatar: string; profileUrl: string };

export type BanEntry = {
	id: string;
	steamId: string;
	steamId64?: string;
	name: string;
	active: boolean;
	permanent: boolean;
	reason: string;
	gamemode?: string;
	numBans?: number;
	appeal?: string;
	bannedAt: number;
	unbanAt: number;
	unbannedAt?: number;
	unbanReason?: string;
	bannedBy?: BanActor;
	unbannedBy?: BanActor;
};

const steam64 = (steamId: string): string | undefined => {
	try {
		const sid = new SteamID(steamId);
		return sid.isValid() ? sid.getSteamID64() : undefined;
	} catch {
		return undefined;
	}
};

export const toEntry = (ban: MetaBan): BanEntry => ({
	id: ban.sid,
	steamId: ban.sid,
	steamId64: steam64(ban.sid),
	name: ban.name,
	active: ban.b,
	// hardbans writes a far future expiry rather than the sentinel, see HARDBAN_ACTOR
	permanent: ban.whenunban === PERMANENT_UNBAN_TIME || ban.bannersid === HARDBAN_ACTOR,
	reason: ban.banreason,
	gamemode: ban.gamemode || undefined,
	numBans: ban.numbans,
	appeal: ban.appeal,
	bannedAt: ban.whenbanned,
	unbanAt: ban.whenunban,
	unbannedAt: ban.whenunbanned,
	unbanReason: ban.unbanreason,
	bannedBy: parseBanActor(ban.bannersid),
	unbannedBy: parseBanActor(ban.unbannersid),
});

/** Every steamid worth resolving a Steam profile for, the banned player and both actors. */
const profileIds = (entries: BanEntry[]): string[] => {
	const ids: string[] = [];
	for (const entry of entries) {
		if (entry.steamId64) ids.push(entry.steamId64);
		for (const actor of [entry.bannedBy, entry.unbannedBy]) {
			if (actor?.kind === "steam" && actor.steamId64) ids.push(actor.steamId64);
		}
	}
	return ids;
};

export const resolveProfiles = async (
	webApp: WebApp,
	entries: BanEntry[]
): Promise<Record<string, Profile>> => {
	const steam = webApp.container.getService("Steam");
	const summaries = await steam.getUserSummariesBulk(profileIds(entries)).catch(() => ({}));
	const profiles: Record<string, Profile> = {};
	for (const [id, summary] of Object.entries(summaries)) {
		profiles[id] = {
			name: summary.personaname,
			avatar: summary.avatarfull,
			profileUrl: summary.profileurl,
		};
	}
	return profiles;
};

/** Sends 401/403 and returns undefined unless the caller is a Metastruct team member. */
const requireTeam = (req: Request, res: Response) => {
	const session = getSession(req);
	if (!session) {
		res.status(401).json({ error: "not logged in" });
		return undefined;
	}
	if (!isTeamMember(session)) {
		res.status(403).json({ error: "not a Metastruct team member" });
		return undefined;
	}
	return session;
};

const clean = (value: unknown, max: number): string =>
	typeof value === "string" ? value.replace(CONTROL_RE, "").trim().slice(0, max) : "";

type BanInput = {
	steamId: string;
	steamId64: string;
	reason: string;
	unbanTime: number;
	gamemode?: string;
	override: boolean;
};

const validateBan = (body: unknown, server?: GmodConnection): BanInput | string => {
	if (!body || typeof body !== "object") return "body must be an object";
	const input = body as Record<string, unknown>;

	if (typeof input.steamId !== "string" || !input.steamId.trim()) return "steamId is required";
	let sid: SteamID;
	try {
		sid = new SteamID(input.steamId.trim());
	} catch {
		return "steamId is not a valid SteamID";
	}
	if (!sid.isValid() || sid.type !== SteamID.Type.INDIVIDUAL)
		return "steamId must be an individual account";

	const reason = clean(input.reason, REASON_MAX);
	if (!reason) return "reason is required";

	// exactly one way of saying when it ends: permanent, a duration, or an absolute
	// timestamp (which is how an edit keeps the expiry it already had)
	const ways = [
		input.permanent === true,
		typeof input.length === "string" && !!input.length.trim(),
		input.unbanAt !== undefined && input.unbanAt !== null,
	].filter(Boolean).length;
	if (ways === 0) return "one of permanent, length or unbanAt is required";
	if (ways > 1) return "permanent, length and unbanAt are mutually exclusive";

	const now = Math.round(Date.now() / 1000);
	let unbanTime: number;
	if (input.permanent === true) {
		unbanTime = PERMANENT_UNBAN_TIME;
	} else if (typeof input.length === "string") {
		// parseDuration returns 0 for anything it didn't understand, which would be
		// a ban that expires immediately
		const seconds = parseDuration(input.length);
		if (seconds <= 0) return "length must look like 1d, 2w or 1y6mo";
		if (seconds > MAX_BAN_LENGTH) return "length may not exceed 10 years, use permanent";
		unbanTime = now + seconds;
	} else {
		const at = Number(input.unbanAt);
		if (!Number.isInteger(at)) return "unbanAt must be a unix timestamp in seconds";
		if (at !== PERMANENT_UNBAN_TIME) {
			if (at <= now) return "unbanAt must be in the future";
			if (at > now + MAX_BAN_LENGTH) return "unbanAt may not be more than 10 years out";
		}
		unbanTime = at;
	}

	let gamemode: string | undefined;
	if (input.gamemode !== undefined && input.gamemode !== null && input.gamemode !== "") {
		if (typeof input.gamemode !== "string" || !GAMEMODE_RE.test(input.gamemode))
			return "gamemode is not a valid gamemode name";
		// a typo'd gamemode produces a ban that never triggers, so reject unknown ones
		if (server?.gamemodes?.length && !server.gamemodes.includes(input.gamemode))
			return `unknown gamemode, the server knows: ${server.gamemodes.join(", ")}`;
		gamemode = input.gamemode;
	}

	return {
		steamId: sid.getSteam2RenderedID(),
		steamId64: sid.getSteamID64(),
		reason,
		unbanTime,
		gamemode,
		override: input.override === true,
	};
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 10 });
	const json = express.json({ limit: "8kb" });

	webApp.app.get("/bans", async (_, res) => {
		const bans = webApp.container.getService("Bans");
		const list = await bans.getBanList();
		const status = bans.getStatus();

		if (status.updatedAt === 0) {
			res.status(502).json({ error: "the ban list is unavailable right now" });
			return;
		}

		const entries = list.map(toEntry);
		res.set("Cache-Control", CACHE_CONTROL);
		res.json({
			bans: entries,
			profiles: await resolveProfiles(webApp, entries),
			updatedAt: status.updatedAt,
			stale: status.stale,
		});
	});

	/** Whether a ban can be issued at all right now, and what gamemodes exist. */
	webApp.app.get("/bans/meta", (req, res) => {
		if (!requireTeam(req, res)) return;
		const server = pickGmodServer(webApp.container.getService("GameBridge"));
		res.set("Cache-Control", "private, no-store");
		res.json({
			serverConnected: !!server,
			server: server?.config.name,
			gamemodes: server?.gamemodes ?? [],
		});
	});

	/** Resolves a steamid so the ban form can show who is about to be banned. */
	webApp.app.get("/bans/lookup/:steamid", async (req, res) => {
		if (!requireTeam(req, res)) return;
		let sid: SteamID;
		try {
			sid = new SteamID(req.params.steamid);
		} catch {
			res.status(404).json({ error: "not a valid SteamID" });
			return;
		}
		if (!sid.isValid() || sid.type !== SteamID.Type.INDIVIDUAL) {
			res.status(404).json({ error: "not an individual SteamID" });
			return;
		}

		const id64 = sid.getSteamID64();
		const steam = webApp.container.getService("Steam");
		const summary = await steam.getUserSummaries(id64).catch(() => undefined);
		const existing = await webApp.container.getService("Bans").getBan(id64);

		res.set("Cache-Control", "private, no-store");
		res.json({
			steamId: sid.getSteam2RenderedID(),
			steamId64: id64,
			name: summary?.personaname,
			avatar: summary?.avatarfull,
			existingBan: existing ? toEntry(existing) : null,
		});
	});

	webApp.app.post("/bans", limiter, json, async (req, res) => {
		const session = requireTeam(req, res);
		if (!session) return;

		const server = pickGmodServer(webApp.container.getService("GameBridge"));

		// validated before the connectivity check so a bad field reports itself rather
		// than hiding behind "no game server", the gamemode check just relaxes when
		// there is no server to compare against
		const input = validateBan(req.body, server);
		if (typeof input === "string") {
			res.status(400).json({ error: input });
			return;
		}

		const bans = webApp.container.getService("Bans");
		const existing = await bans.getBan(input.steamId64);
		if (existing?.b && !input.override) {
			res.status(409).json({
				error: "that player is already banned",
				ban: toEntry(existing),
			});
			return;
		}

		if (!server) {
			res.status(503).json({ error: "no game server is connected right now" });
			return;
		}

		// banni stores the nick at ban time; the website always takes it from Steam so a
		// moderator cannot mislabel the record
		const summary = await webApp.container
			.getService("Steam")
			.getUserSummaries(input.steamId64)
			.catch(() => undefined);
		const nick = clean(summary?.personaname, NICK_MAX) || "???";

		const ok = await issueBan(
			server,
			{
				steamId: input.steamId,
				nick,
				actor: githubActor(session.login),
				reason: input.reason,
				unbanTime: input.unbanTime,
				gamemode: input.gamemode,
			},
			session.login
		);

		if (ok === undefined) {
			res.status(503).json({ error: "the game server did not answer" });
			return;
		}
		if (!ok) {
			res.status(502).json({ error: "the game server refused the ban" });
			return;
		}

		log.info(
			`${session.login}: banned ${input.steamId} (${nick}) until ${input.unbanTime}` +
				`${input.gamemode ? ` in ${input.gamemode}` : ""} for: ${input.reason}`
		);

		await respondWithFresh(webApp, res, input.steamId64, () => ({
			id: input.steamId,
			steamId: input.steamId,
			steamId64: input.steamId64,
			name: nick,
			active: true,
			permanent: input.unbanTime === PERMANENT_UNBAN_TIME,
			reason: input.reason,
			gamemode: input.gamemode,
			bannedAt: Math.round(Date.now() / 1000),
			unbanAt: input.unbanTime,
			bannedBy: parseBanActor(githubActor(session.login)),
		}));
	});

	webApp.app.post("/bans/:steamid/unban", limiter, json, async (req, res) => {
		const session = requireTeam(req, res);
		if (!session) return;

		let sid: SteamID;
		try {
			sid = new SteamID(req.params.steamid);
		} catch {
			res.status(400).json({ error: "not a valid SteamID" });
			return;
		}
		if (!sid.isValid() || sid.type !== SteamID.Type.INDIVIDUAL) {
			res.status(400).json({ error: "not an individual SteamID" });
			return;
		}

		const reason = clean(req.body?.reason, REASON_MAX);
		if (!reason) {
			res.status(400).json({ error: "reason is required" });
			return;
		}

		const bans = webApp.container.getService("Bans");
		const existing = await bans.getBan(sid.getSteamID64());
		if (!existing) {
			res.status(404).json({ error: "that player has never been banned" });
			return;
		}
		if (!existing.b) {
			res.status(409).json({ error: "that ban has already been lifted" });
			return;
		}

		const server = pickGmodServer(webApp.container.getService("GameBridge"));
		if (!server) {
			res.status(503).json({ error: "no game server is connected right now" });
			return;
		}

		const ok = await revokeBan(
			server,
			{ steamId: existing.sid, actor: githubActor(session.login), reason },
			session.login
		);

		if (ok === undefined) {
			res.status(503).json({ error: "the game server did not answer" });
			return;
		}
		if (!ok) {
			res.status(502).json({ error: "the game server refused the unban" });
			return;
		}

		log.info(`${session.login}: unbanned ${existing.sid} (${existing.name}) for: ${reason}`);

		await respondWithFresh(webApp, res, sid.getSteamID64(), () => ({
			...toEntry(existing),
			active: false,
			unbannedAt: Math.round(Date.now() / 1000),
			unbanReason: reason,
			unbannedBy: parseBanActor(githubActor(session.login)),
		}));
	});
};

/**
 * Force refreshes the cache so the writer immediately sees their own change, then answers with
 * the authoritative record. The write already happened, so a refresh that doesn't show it yet
 * falls back to the caller's optimistic version rather than failing the request.
 */
const respondWithFresh = async (
	webApp: WebApp,
	res: Response,
	steamId64: string,
	fallback: () => BanEntry
): Promise<void> => {
	const bans = webApp.container.getService("Bans");
	await bans.updateCache(true);
	const fresh = await bans.getBan(steamId64);
	const ban = fresh ? toEntry(fresh) : fallback();
	res.set("Cache-Control", "private, no-store");
	res.json({ ban, profiles: await resolveProfiles(webApp, [ban]) });
};
