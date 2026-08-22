import type { Request, Response } from "express";
import { Octokit } from "@octokit/rest";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import GithubConfig from "@/config/github.json" with { type: "json" };
import HistoryConfig from "@/config/history.json" with { type: "json" };
import WebAppConfig from "@/config/webapp.json" with { type: "json" };
import crypto from "crypto";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const STATE_COOKIE = "ghState";
const SESSION_COOKIE = "ghSession";
const SESSION_TTL = 8 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";

export type EditorSession = {
	login: string;
	avatarUrl: string;
	token: string;
	expiresAt: number;
	/** Teams from history.json the user is an active member of. */
	teams?: string[];
};

// signed cookies are readable by the browser, the token must not be
const key = crypto.createHash("sha256").update(WebAppConfig.cookieSecret).digest();

const encrypt = (data: unknown): string => {
	const iv = crypto.randomBytes(12);
	const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
	const body = Buffer.concat([cipher.update(JSON.stringify(data), "utf8"), cipher.final()]);
	return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
};

const decrypt = <T>(value: string): T | undefined => {
	try {
		const buf = Buffer.from(value, "base64url");
		const decipher = crypto.createDecipheriv("aes-256-gcm", key, buf.subarray(0, 12));
		decipher.setAuthTag(buf.subarray(12, 28));
		const body = Buffer.concat([decipher.update(buf.subarray(28)), decipher.final()]);
		return JSON.parse(body.toString("utf8")) as T;
	} catch {
		return undefined;
	}
};

const cookieOptions = {
	httpOnly: true,
	secure: IS_PROD,
	sameSite: "lax" as const,
	domain: IS_PROD ? WebAppConfig.cookieDomain : undefined,
};

const sessionFromRaw = (raw: unknown): EditorSession | undefined => {
	if (typeof raw !== "string") return;
	const session = decrypt<EditorSession>(raw);
	if (!session || session.expiresAt < Date.now()) return;
	return session;
};

export const getSession = (req: Request): EditorSession | undefined =>
	sessionFromRaw(req.cookies?.[SESSION_COOKIE]);

/** For requests that didn't go through cookie-parser (websocket upgrades). */
export const getSessionFromCookieHeader = (
	header: string | undefined
): EditorSession | undefined => {
	const raw = header
		?.split(";")
		.map(part => part.trim().split("="))
		.find(([name]) => name === SESSION_COOKIE)?.[1];
	return sessionFromRaw(raw);
};

/** Sends 401 and returns undefined when the request carries no valid editor session. */
export const requireEditor = (req: Request, res: Response): EditorSession | undefined => {
	const session = getSession(req);
	if (!session) res.status(401).json({ error: "not logged in" });
	return session;
};

const safeRedirect = (value: unknown): string => {
	if (typeof value === "string" && /^\/(?!\/)[a-zA-Z0-9\-_/#?=&.]*$/.test(value)) return value;
	return "/";
};

const getTeams = async (octokit: Octokit, login: string): Promise<string[]> => {
	const teams: string[] = [];
	for (const team of HistoryConfig.teams) {
		try {
			const { data } = await octokit.teams.getMembershipForUserInOrg({
				org: HistoryConfig.org,
				team_slug: team,
				username: login,
			});
			if (data.state === "active") teams.push(team);
		} catch (err) {
			const status = (err as { status?: number }).status;
			if (status !== 404) log.warn(err, `team membership check failed for ${team}`);
		}
	}
	return teams;
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });

	webApp.app.get("/auth/github", limiter, (req, res) => {
		const state = crypto.randomUUID();
		res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 5 * 60 * 1000, signed: true });
		// target=self lands on this host (the dashboard) instead of the website
		const base = req.query.target === "self" ? webApp.config.url : webApp.config.siteUrl;
		res.cookie("ghRedirect", base + safeRedirect(req.query.redirect), {
			...cookieOptions,
			maxAge: 5 * 60 * 1000,
			signed: true,
		});

		const url = new URL("https://github.com/login/oauth/authorize");
		url.searchParams.set("client_id", GithubConfig.clientId);
		url.searchParams.set("redirect_uri", `${webApp.config.url}/auth/github/callback`);
		url.searchParams.set("state", state);
		// ignored by GitHub Apps (permissions come from the app), required for classic OAuth apps
		url.searchParams.set("scope", "read:org repo");
		res.redirect(url.toString());
	});

	webApp.app.get("/auth/github/callback", limiter, async (req, res) => {
		const { code, state } = req.query;
		const expected = req.signedCookies?.[STATE_COOKIE];
		const stored = req.signedCookies?.ghRedirect;
		const redirect = [webApp.config.url, webApp.config.siteUrl].some(
			base => typeof stored === "string" && stored.startsWith(base + "/")
		)
			? (stored as string)
			: webApp.config.siteUrl + "/";
		res.clearCookie(STATE_COOKIE, cookieOptions);
		res.clearCookie("ghRedirect", cookieOptions);

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
				redirect_uri: `${webApp.config.url}/auth/github/callback`,
			}),
		}).catch(err => {
			log.error(err, "github token exchange failed");
		});
		const tokens = tokenRes?.ok
			? ((await tokenRes.json()) as { access_token?: string; error?: string })
			: undefined;
		if (!tokens?.access_token) {
			log.warn(tokens, "github token exchange returned no token");
			res.status(502).send("github login failed");
			return;
		}

		const octokit = new Octokit({ auth: tokens.access_token });
		let user: { login: string; avatar_url: string };
		try {
			user = (await octokit.users.getAuthenticated()).data;
		} catch (err) {
			log.error(err, "failed fetching github user");
			res.status(502).send("github login failed");
			return;
		}

		const teams = await getTeams(octokit, user.login);
		if (!teams.length) {
			log.info(`github login refused for ${user.login}`);
			res.status(403).send(
				`<!doctype html><meta charset="utf-8"><body style="font-family:sans-serif;background:#222;color:#eee;padding:2em">` +
					`<h1>Not allowed</h1><p>${user.login} is not in the ${HistoryConfig.org} ${HistoryConfig.teams.join(" or ")} teams.</p>` +
					`<p><a style="color:#8cf" href="${webApp.config.siteUrl}">Back to the site</a></p>`
			);
			return;
		}

		const session: EditorSession = {
			login: user.login,
			avatarUrl: user.avatar_url,
			token: tokens.access_token,
			expiresAt: Date.now() + SESSION_TTL,
			teams,
		};
		res.cookie(SESSION_COOKIE, encrypt(session), { ...cookieOptions, maxAge: SESSION_TTL });
		log.info(`github login for ${user.login}`);
		res.redirect(redirect);
	});

	webApp.app.get("/auth/me", (req, res) => {
		res.set("Cache-Control", "no-store");
		const session = getSession(req);
		if (!session) {
			res.status(401).json({});
			return;
		}
		res.json({
			login: session.login,
			avatarUrl: session.avatarUrl,
			isAdmin: true,
			teams: session.teams ?? [],
		});
	});

	webApp.app.post("/auth/logout", (req, res) => {
		res.clearCookie(SESSION_COOKIE, cookieOptions);
		// plain form submit from the dashboard login page, fetch() callers get a 204
		if (req.accepts(["json", "html"]) === "html") res.redirect("/");
		else res.status(204).end();
	});
};
