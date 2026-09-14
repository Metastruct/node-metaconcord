import { Octokit } from "@octokit/rest";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import { Accounts, LinkConflictError } from "@/app/services/Accounts.js";
import {
	cookieOptions,
	getSessionAccountId,
	setSessionCookie,
	storeRedirect,
	takeRedirect,
} from "./session.js";
import GithubConfig from "@/config/github.json" with { type: "json" };
import crypto from "crypto";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const STATE_COOKIE = "ghState";

/**
 * GitHub login and linking. The user token is kept on the link because the history
 * editor commits in the user's name; roles come from team membership (see Accounts).
 */
export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const callbackUrl = `${webApp.config.url}/auth/github/callback`;

	webApp.app.get("/auth/github", limiter, (req, res) => {
		const state = crypto.randomUUID();
		res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 5 * 60 * 1000, signed: true });
		storeRedirect(webApp, req, res);

		const url = new URL("https://github.com/login/oauth/authorize");
		url.searchParams.set("client_id", GithubConfig.clientId);
		url.searchParams.set("redirect_uri", callbackUrl);
		url.searchParams.set("state", state);
		// ignored by GitHub Apps (permissions come from the app), required for classic OAuth apps
		url.searchParams.set("scope", "read:org repo");
		res.redirect(url.toString());
	});

	webApp.app.get("/auth/github/callback", limiter, async (req, res) => {
		const { code, state } = req.query;
		const expected = req.signedCookies?.[STATE_COOKIE];
		const redirect = takeRedirect(webApp, req, res);
		res.clearCookie(STATE_COOKIE, cookieOptions);

		if (typeof code !== "string" || !state || !expected || state !== expected) {
			res.status(403).send("invalid oauth state");
			return;
		}

		const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
			method: "POST",
			headers: { Accept: "application/json", "Content-Type": "application/json" },
			body: JSON.stringify({
				client_id: GithubConfig.clientId,
				client_secret: GithubConfig.clientSecret,
				code,
				redirect_uri: callbackUrl,
			}),
		}).catch(err => {
			log.error(err, "github token exchange failed");
		});
		const tokens = tokenRes?.ok
			? ((await tokenRes.json()) as {
					access_token?: string;
					refresh_token?: string;
					expires_in?: number;
					error?: string;
				})
			: undefined;
		if (!tokens?.access_token) {
			log.warn(tokens, "github token exchange returned no token");
			res.status(502).send("github login failed");
			return;
		}

		let user: { id: number; login: string; avatar_url: string };
		try {
			user = (await new Octokit({ auth: tokens.access_token }).users.getAuthenticated()).data;
		} catch (err) {
			log.error(err, "failed fetching github user");
			res.status(502).send("github login failed");
			return;
		}

		try {
			const account = await webApp.container
				.getService("Accounts")
				.loginOrLink(getSessionAccountId(req), {
					provider: "github",
					providerId: String(user.id),
					name: user.login,
					avatar: user.avatar_url,
					source: "oauth",
					token: Accounts.tokenFromResponse(tokens),
				});
			setSessionCookie(res, account);
			log.info(`github login for ${user.login} (account ${account.id})`);
			res.redirect(redirect);
		} catch (err) {
			if (err instanceof LinkConflictError) {
				res.redirect(`${webApp.config.siteUrl}/profile?error=conflict&provider=github`);
				return;
			}
			throw err;
		}
	});
};
