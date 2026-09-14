import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import { LinkConflictError } from "@/app/services/Accounts.js";
import {
	cookieOptions,
	getSessionAccountId,
	setSessionCookie,
	storeRedirect,
	takeRedirect,
} from "./session.js";
import GitlabConfig from "@/config/gitlab.json" with { type: "json" };
import crypto from "crypto";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const STATE_COOKIE = "glState";
const GITLAB_URL = "https://gitlab.com";

/** GitLab login and linking, identity only. The app needs the read_user scope. */
export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const callbackUrl = `${webApp.config.url}/auth/gitlab/callback`;
	const oauth = GitlabConfig.oauth;

	webApp.app.get("/auth/gitlab", limiter, (req, res) => {
		const state = crypto.randomUUID();
		res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 5 * 60 * 1000, signed: true });
		storeRedirect(webApp, req, res);

		const url = new URL(`${GITLAB_URL}/oauth/authorize`);
		url.searchParams.set("client_id", oauth.clientId);
		url.searchParams.set("redirect_uri", callbackUrl);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("state", state);
		url.searchParams.set("scope", "read_user");
		res.redirect(url.toString());
	});

	webApp.app.get("/auth/gitlab/callback", limiter, async (req, res) => {
		const { code, state } = req.query;
		const expected = req.signedCookies?.[STATE_COOKIE];
		const redirect = takeRedirect(webApp, req, res);
		res.clearCookie(STATE_COOKIE, cookieOptions);

		if (typeof code !== "string" || !state || !expected || state !== expected) {
			res.status(403).send("invalid oauth state");
			return;
		}

		const tokenRes = await fetch(`${GITLAB_URL}/oauth/token`, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: new URLSearchParams({
				client_id: oauth.clientId,
				client_secret: oauth.clientSecret,
				code,
				grant_type: "authorization_code",
				redirect_uri: callbackUrl,
			}),
		}).catch(err => {
			log.error(err, "gitlab token exchange failed");
		});
		const tokens = tokenRes?.ok
			? ((await tokenRes.json()) as { access_token?: string })
			: undefined;
		if (!tokens?.access_token) {
			log.warn(tokens, "gitlab token exchange returned no token");
			res.status(502).send("gitlab login failed");
			return;
		}

		const userRes = await fetch(`${GITLAB_URL}/api/v4/user`, {
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		}).catch(err => {
			log.error(err, "failed fetching gitlab user");
		});
		const user = userRes?.ok
			? ((await userRes.json()) as { id: number; username: string; avatar_url?: string })
			: undefined;
		if (!user) {
			res.status(502).send("gitlab login failed");
			return;
		}

		try {
			const account = await webApp.container
				.getService("Accounts")
				.loginOrLink(getSessionAccountId(req), {
					provider: "gitlab",
					providerId: String(user.id),
					name: user.username,
					avatar: user.avatar_url,
					source: "oauth",
				});
			setSessionCookie(res, account);
			log.info(`gitlab login for ${user.username} (account ${account.id})`);
			res.redirect(redirect);
		} catch (err) {
			if (err instanceof LinkConflictError) {
				res.redirect(`${webApp.config.siteUrl}/profile?error=conflict&provider=gitlab`);
				return;
			}
			throw err;
		}
	});
};
