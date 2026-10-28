import { Octokit } from "@octokit/rest";
import { WebApp } from "#/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "#/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import { Accounts, LinkConflictError } from "#/app/services/Accounts.js";
import {
	cookieOptions,
	getSessionAccountId,
	setSessionCookie,
	storeRedirect,
	takeRedirect,
} from "./session.js";
import GithubConfig from "#/config/github.json" with { type: "json" };
import crypto from "node:crypto";
import { logger } from "#/utils.js";

const log = logger(import.meta);

const STATE_COOKIE = "ghState";

/**
 * GitHub login and linking. The user token is kept on the link because the history
 * editor commits in the user's name; roles come from team membership (see Accounts).
 */
export default function githubAuth(webApp: WebApp): void {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });
	const callbackUrl = `${webApp.config.url}/auth/github/callback`;
	const oauth = GithubConfig.oauth;
	/** the write scope the history editor re-authorizes for, on top of the login scopes */
	const EDITOR_SCOPE = "public_repo";
	// a config without the split-out scope keeps the identity default
	const loginScope = oauth.scope ?? "read:user user:email";

	webApp.app.get("/auth/github", limiter, (req, res) => {
		const state = crypto.randomUUID();
		res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 5 * 60 * 1000, signed: true });
		storeRedirect(webApp, req, res);

		// login is identity only; the site's github_reauth handler (history editor)
		// adds editor=1 to ask for the write scope
		const scope = req.query.editor === "1" ? `${loginScope} ${EDITOR_SCOPE}` : loginScope;

		const url = new URL("https://github.com/login/oauth/authorize");
		url.searchParams.set("client_id", oauth.clientId);
		url.searchParams.set("redirect_uri", callbackUrl);
		url.searchParams.set("state", state);
		url.searchParams.set("scope", scope);
		res.redirect(url.href);
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
				client_id: oauth.clientId,
				client_secret: oauth.clientSecret,
				code,
				redirect_uri: callbackUrl,
			}),
		}).catch(error => {
			log.error(error, "github token exchange failed");
		});
		const tokens = tokenRes && tokenRes.ok
			? ((await tokenRes.json()) as {
				access_token?: string;
				refresh_token?: string;
				expires_in?: number;
				scope?: string;
				error?: string;
			})
			: undefined;
		if (!tokens?.access_token) {
			log.warn(tokens, "github token exchange returned no token");
			res.status(502).send("github login failed");
			return;
		}

		let user: { id: number; login: string; avatar_url: string };
		let primaryEmail: string | undefined;
		try {
			const octokit = new Octokit({ auth: tokens.access_token });
			user = (await octokit.users.getAuthenticated()).data;
			// primary verified email (works even when the profile email is private);
			// needs the user:email scope / the app's "Email addresses" permission
			const emails = await octokit.users
				.listEmailsForAuthenticatedUser()
				.then(({ data }) => data)
				.catch(() => undefined);
			const primary =
				emails?.find(e => e.primary && e.verified) ?? emails?.find(e => e.verified);
			primaryEmail = primary?.email ?? undefined;
		} catch (error) {
			log.error(error, "failed fetching github user");
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
					email: primaryEmail,
					emailVerified: !!primaryEmail,
				});
			setSessionCookie(res, account);
			log.info(`github login for ${user.login} (account ${account.id})`);
			res.redirect(redirect);
		} catch (error) {
			if (error instanceof LinkConflictError) {
				res.redirect(`${webApp.config.siteUrl}/profile?error=conflict&provider=github`);
				return;
			}
			throw error;
		}
	});
}
