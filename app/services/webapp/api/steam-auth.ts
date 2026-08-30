import type { Request } from "express";
import { cookieOptions, decrypt, encrypt, safeRedirect } from "./github-auth.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import axios from "axios";

const log = logger(import.meta);

/**
 * Steam login for the website, used by banned players appealing their ban. Unlike the
 * GitHub login this grants nothing: it only proves which steamid the visitor owns.
 * Steam OpenID mechanics are the same as steam-oauth (which stays dedicated to Discord
 * role linking), the session cookie works exactly like ghSession.
 */

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

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const callbackUrl = `${webApp.config.url}/auth/steam/callback`;

	webApp.app.get("/auth/steam", limiter, (req, res) => {
		res.cookie(REDIRECT_COOKIE, webApp.config.siteUrl + safeRedirect(req.query.redirect), {
			...cookieOptions,
			maxAge: 5 * 60 * 1000,
			signed: true,
		});

		const url = new URL("https://steamcommunity.com/openid/login");
		url.search = new URLSearchParams({
			"openid.ns": "http://specs.openid.net/auth/2.0",
			"openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
			"openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
			"openid.return_to": callbackUrl,
			"openid.realm": webApp.config.url,
			"openid.mode": "checkid_setup",
		}).toString();
		res.redirect(url.toString());
	});

	webApp.app.get("/auth/steam/callback", limiter, async (req, res) => {
		const stored = req.signedCookies?.[REDIRECT_COOKIE];
		const redirect =
			typeof stored === "string" && stored.startsWith(webApp.config.siteUrl + "/")
				? stored
				: webApp.config.siteUrl + "/";
		res.clearCookie(REDIRECT_COOKIE, cookieOptions);

		// return_to is in the signed field set, so a response minted for another
		// consumer cannot be replayed here
		const returnTo = req.query["openid.return_to"]?.toString();
		if (!returnTo || !returnTo.startsWith(callbackUrl)) {
			res.status(403).send("invalid steam response");
			return;
		}

		const query = { ...req.query, "openid.mode": "check_authentication" };
		const valid = await axios
			.get("https://steamcommunity.com/openid/login", { params: query })
			.catch(err => {
				log.error(err, "steam openid verification failed");
			});
		const ident = req.query["openid.identity"]?.toString();
		if (!valid || !String(valid.data).includes("is_valid:true") || !ident) {
			res.status(403).send("steam login failed");
			return;
		}

		const steamId64 = ident.match(/^https:\/\/steamcommunity\.com\/openid\/id\/(\d+)$/)?.[1];
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
};
