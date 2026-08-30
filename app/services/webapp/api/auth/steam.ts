import type { Request } from "express";
import { cookieOptions, decrypt, encrypt, safeRedirect } from "./github.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import SteamID from "steamid";
import axios from "axios";

const log = logger(import.meta);

/**
 * Everything Steam OpenID: the website login used by banned players appealing their ban
 * (a steamSession cookie working exactly like ghSession, granting nothing but proof of
 * which steamid the visitor owns), and the older Discord role linking flow. Both share
 * the same redirect/verify mechanics.
 */

const OPENID_URL = "https://steamcommunity.com/openid/login";

const SESSION_COOKIE = "steamSession";
const REDIRECT_COOKIE = "steamRedirect";
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

export type SteamSession = {
	steamId64: string;
	name: string;
	avatar: string;
	expiresAt: number;
};

export const getSteamSession = (req: Request): SteamSession | undefined => {
	const raw = req.cookies?.[SESSION_COOKIE];
	if (typeof raw !== "string") return;
	const session = decrypt<SteamSession>(raw);
	if (!session || session.expiresAt < Date.now()) return;
	return session;
};

const steamLoginUrl = (returnTo: string, realm: string): string => {
	const url = new URL(OPENID_URL);
	url.search = new URLSearchParams({
		"openid.ns": "http://specs.openid.net/auth/2.0",
		"openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
		"openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
		"openid.return_to": returnTo,
		"openid.realm": realm,
		"openid.mode": "checkid_setup",
	}).toString();
	return url.toString();
};

/**
 * Verifies a Steam OpenID callback and returns the steamid64, or undefined when anything
 * about it is wrong. return_to is in the signed field set, so requiring it to match the
 * receiving endpoint stops responses minted for another consumer from being replayed.
 */
const verifySteamOpenId = async (
	query: Request["query"],
	expectedReturnTo: string
): Promise<string | undefined> => {
	const returnTo = query["openid.return_to"]?.toString();
	if (!returnTo || !returnTo.startsWith(expectedReturnTo)) return;

	const params = { ...query, "openid.mode": "check_authentication" };
	const valid = await axios.get(OPENID_URL, { params }).catch(err => {
		log.error(err, "steam openid verification failed");
	});
	const ident = query["openid.identity"]?.toString();
	if (!valid || !String(valid.data).includes("is_valid:true") || !ident) return;

	return ident.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/)?.[1];
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const callbackUrl = `${webApp.config.url}/auth/steam/callback`;
	const linkCallbackUrl = `${webApp.config.url}/steam/auth/callback/`;

	// --- website login ---

	webApp.app.get("/auth/steam", limiter, (req, res) => {
		res.cookie(REDIRECT_COOKIE, webApp.config.siteUrl + safeRedirect(req.query.redirect), {
			...cookieOptions,
			maxAge: 5 * 60 * 1000,
			signed: true,
		});
		res.redirect(steamLoginUrl(callbackUrl, webApp.config.url));
	});

	webApp.app.get("/auth/steam/callback", limiter, async (req, res) => {
		const stored = req.signedCookies?.[REDIRECT_COOKIE];
		const redirect =
			typeof stored === "string" && stored.startsWith(webApp.config.siteUrl + "/")
				? stored
				: webApp.config.siteUrl + "/";
		res.clearCookie(REDIRECT_COOKIE, cookieOptions);

		const steamId64 = await verifySteamOpenId(req.query, callbackUrl);
		if (!steamId64) {
			res.status(403).send("steam login failed");
			return;
		}

		// cosmetic only, the login still succeeds when the profile lookup fails
		const summary = await webApp.container
			.getService("Steam")
			.getUserSummaries(steamId64)
			.catch(() => undefined);

		const session: SteamSession = {
			steamId64,
			name: summary?.personaname || steamId64,
			avatar: summary?.avatarfull ?? "",
			expiresAt: Date.now() + SESSION_TTL,
		};
		res.cookie(SESSION_COOKIE, encrypt(session), { ...cookieOptions, maxAge: SESSION_TTL });
		log.info(`steam login for ${steamId64}`);
		res.redirect(redirect);
	});

	webApp.app.get("/auth/steam/me", (req, res) => {
		res.set("Cache-Control", "no-store");
		const session = getSteamSession(req);
		if (!session) {
			res.status(401).json({});
			return;
		}
		res.json({ steamId64: session.steamId64, name: session.name, avatar: session.avatar });
	});

	webApp.app.post("/auth/steam/logout", (_, res) => {
		res.clearCookie(SESSION_COOKIE, cookieOptions);
		res.status(204).end();
	});

	// --- discord role linking ---

	webApp.app.get("/steam/link/:id", limiter, (req, res) => {
		const userId = req.params.id;
		if (!userId) {
			res.status(403).send("Missing userid for linking");
			return;
		}
		res.redirect(steamLoginUrl(`${linkCallbackUrl}${userId}`, webApp.config.url));
	});

	webApp.app.get("/steam/auth/callback/:id", limiter, async (req, res) => {
		const userId = req.params.id;
		if (!userId) {
			res.status(403).send("Missing userid for linking");
			return;
		}

		const steamId64 = await verifySteamOpenId(req.query, linkCallbackUrl);
		if (!steamId64) {
			res.status(403).send("Invalid Steam Response?");
			return;
		}

		await webApp.container
			.getService("SQL")
			.queryPool(
				"INSERT INTO discord_link (accountid, discorduserid, linked_at) VALUES($1, $2, $3) ON CONFLICT (accountid) DO UPDATE SET linked_at = EXCLUDED.linked_at, discorduserid = EXCLUDED.discorduserid;",
				[new SteamID(steamId64).accountid, userId, new Date()]
			);

		res.redirect("/discord/link");
	});
};
