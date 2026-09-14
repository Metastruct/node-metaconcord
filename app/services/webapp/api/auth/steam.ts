import type { Request } from "express";
import { LinkConflictError } from "@/app/services/Accounts.js";
import { getSessionAccountId, setSessionCookie, storeRedirect, takeRedirect } from "./session.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import axios from "axios";

const log = logger(import.meta);

/** Steam OpenID login and linking. Steam can also be linked from a gmod server with a code. */

const OPENID_URL = "https://steamcommunity.com/openid/login";

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

	webApp.app.get("/auth/steam", limiter, (req, res) => {
		storeRedirect(webApp, req, res);
		res.redirect(steamLoginUrl(callbackUrl, webApp.config.url));
	});

	webApp.app.get("/auth/steam/callback", limiter, async (req, res) => {
		const redirect = takeRedirect(webApp, req, res);

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

		try {
			const account = await webApp.container
				.getService("Accounts")
				.loginOrLink(getSessionAccountId(req), {
					provider: "steam",
					providerId: steamId64,
					name: summary?.personaname || steamId64,
					avatar: summary?.avatarfull,
					source: "openid",
				});
			setSessionCookie(res, account);
			log.info(`steam login for ${steamId64} (account ${account.id})`);
			res.redirect(redirect);
		} catch (err) {
			if (err instanceof LinkConflictError) {
				res.redirect(`${webApp.config.siteUrl}/profile?error=conflict&provider=steam`);
				return;
			}
			throw err;
		}
	});
};
