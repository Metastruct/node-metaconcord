import type { Request, Response } from "express";
import {
	Accounts,
	AccountWithLinks,
	CODE_PROVIDERS,
	LastLoginError,
	LOGIN_PROVIDERS,
	Provider,
	Role,
	STAFF_ROLES,
} from "@/app/services/Accounts.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import express from "express";
import { decrypt, encrypt } from "@/app/services/webapp/secretBox.js";
import WebAppConfig from "@/config/webapp.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * The one website session: an encrypted cookie naming an account (see services/Accounts),
 * resolved on every request so links and roles are always current. Provider modules
 * (github, gitlab, steam, discord) only create it, everything else reads it from here.
 */

const SESSION_COOKIE = "mcSession";
const SESSION_TTL = 30 * 24 * 60 * 60 * 1000;
const IS_PROD = process.env.NODE_ENV === "production";

type SessionCookie = { accountId: number; expiresAt: number };

export type Session = {
	account: AccountWithLinks;
	roles: Role[];
	/** what log lines call the person */
	login: string;
	expiresAt: number;
};

export const cookieOptions = {
	httpOnly: true,
	secure: IS_PROD,
	sameSite: "lax" as const,
	domain: IS_PROD ? WebAppConfig.cookieDomain : undefined,
};

export const safeRedirect = (value: unknown): string => {
	if (typeof value === "string" && /^\/(?!\/)[a-zA-Z0-9\-_/#?=&.]*$/.test(value)) return value;
	return "/";
};

const accounts = (): Accounts => globalThis.MetaConcord.container.getService("Accounts");

const sessionFromRaw = async (raw: unknown): Promise<Session | undefined> => {
	if (typeof raw !== "string") return;
	const cookie = decrypt<SessionCookie>(raw);
	if (!cookie || cookie.expiresAt < Date.now()) return;
	let account = await accounts().get(cookie.accountId);
	if (!account) return;
	account = await accounts().ensureRoles(account);
	return {
		account,
		roles: account.roles,
		login: account.displayName,
		expiresAt: cookie.expiresAt,
	};
};

export const getSession = (req: Request): Promise<Session | undefined> =>
	sessionFromRaw(req.cookies?.[SESSION_COOKIE]);

/** For requests that didn't go through cookie-parser (websocket upgrades). */
export const getSessionFromCookieHeader = (
	header: string | undefined
): Promise<Session | undefined> => {
	const raw = header
		?.split(";")
		.map(part => part.trim().split("="))
		.find(([name]) => name === SESSION_COOKIE)?.[1];
	return sessionFromRaw(raw);
};

/** The id a provider callback links to, without resolving the whole account. */
export const getSessionAccountId = (req: Request): number | undefined => {
	const raw = req.cookies?.[SESSION_COOKIE];
	if (typeof raw !== "string") return;
	const cookie = decrypt<SessionCookie>(raw);
	if (!cookie || cookie.expiresAt < Date.now()) return;
	return cookie.accountId;
};

export const setSessionCookie = (res: Response, accountId: number): void => {
	const cookie: SessionCookie = { accountId, expiresAt: Date.now() + SESSION_TTL };
	res.cookie(SESSION_COOKIE, encrypt(cookie), { ...cookieOptions, maxAge: SESSION_TTL });
};

export const clearSessionCookie = (res: Response): void => {
	res.clearCookie(SESSION_COOKIE, cookieOptions);
};

export const hasRole = (session: Session | undefined, ...roles: Role[]): session is Session =>
	!!session && roles.some(r => session.roles.includes(r));

export const isStaff = (session?: Session): session is Session => hasRole(session, ...STAFF_ROLES);

/** Sends 401/403 and returns undefined unless the session holds one of the roles. */
export const requireRole = async (
	req: Request,
	res: Response,
	...roles: Role[]
): Promise<Session | undefined> => {
	const session = await getSession(req);
	if (!session) {
		res.status(401).json({ error: "not logged in" });
		return;
	}
	if (!hasRole(session, ...roles)) {
		res.status(403).json({ error: `${roles.join(" or ")} only` });
		return;
	}
	return session;
};

export const requireStaff = (req: Request, res: Response): Promise<Session | undefined> =>
	requireRole(req, res, ...STAFF_ROLES);

/** The shape /auth/me answers with, also what the profile page renders. */
export const publicAccount = (session: Session) => ({
	id: session.account.id,
	displayName: session.account.displayName,
	avatar: session.account.avatar,
	roles: session.roles,
	links: session.account.links.map(l => ({
		provider: l.provider,
		id: l.providerId,
		name: l.name,
		avatar: l.avatar,
		source: l.source,
	})),
});

/**
 * Where a provider callback sends the browser afterwards: the site by default, this host
 * when the login started from the dashboard (target=self). Stored in a short signed cookie
 * by the provider's start route and validated here so an open redirect is impossible.
 */
export const REDIRECT_COOKIE = "authRedirect";

export const storeRedirect = (webApp: WebApp, req: Request, res: Response): void => {
	const base = req.query.target === "self" ? webApp.config.url : webApp.config.siteUrl;
	res.cookie(REDIRECT_COOKIE, base + safeRedirect(req.query.redirect), {
		...cookieOptions,
		maxAge: 5 * 60 * 1000,
		signed: true,
	});
};

export const takeRedirect = (
	webApp: WebApp,
	req: Request,
	res: Response,
	fallback = webApp.config.siteUrl + "/"
): string => {
	const stored = req.signedCookies?.[REDIRECT_COOKIE];
	res.clearCookie(REDIRECT_COOKIE, cookieOptions);
	const ok = [webApp.config.url, webApp.config.siteUrl].some(
		base => typeof stored === "string" && stored.startsWith(base + "/")
	);
	return ok ? (stored as string) : fallback;
};

const isProvider = (value: unknown): value is Provider =>
	typeof value === "string" && (LOGIN_PROVIDERS as string[]).concat("minecraft").includes(value);

export default (webApp: WebApp): void => {
	const limiter = rateLimit({ keyGenerator: rateLimitKeyGenerator, windowMs: 60_000, limit: 30 });

	webApp.app.get("/auth/me", async (req, res) => {
		res.set("Cache-Control", "no-store");
		const session = await getSession(req);
		if (!session) {
			res.status(401).json({});
			return;
		}
		res.json(publicAccount(session));
	});

	webApp.app.post("/auth/logout", (req, res) => {
		clearSessionCookie(res);
		// plain form submit from the dashboard login page, fetch() callers get a 204
		if (req.accepts(["json", "html"]) === "html") res.redirect("/");
		else res.status(204).end();
	});

	webApp.app.delete("/auth/links/:provider", limiter, async (req, res) => {
		const session = await getSession(req);
		if (!session) {
			res.status(401).json({ error: "not logged in" });
			return;
		}
		const provider = req.params.provider;
		if (!isProvider(provider)) {
			res.status(404).json({ error: "unknown provider" });
			return;
		}
		try {
			const account = await accounts().removeLink(session.account.id, provider);
			log.info(`${session.login} unlinked ${provider}`);
			res.json(publicAccount({ ...session, account, roles: account.roles }));
		} catch (err) {
			if (err instanceof LastLoginError) {
				res.status(409).json({ error: err.message });
				return;
			}
			throw err;
		}
	});

	webApp.app.post(
		"/auth/link-code",
		limiter,
		express.json({ limit: "1kb" }),
		async (req, res) => {
			const session = await getSession(req);
			if (!session) {
				res.status(401).json({ error: "not logged in" });
				return;
			}
			const provider = (req.body as { provider?: unknown } | undefined)?.provider;
			if (!isProvider(provider) || !CODE_PROVIDERS.includes(provider)) {
				res.status(400).json({ error: "provider must be steam or minecraft" });
				return;
			}
			res.json(await accounts().createLinkCode(session.account.id, provider));
		}
	);
};
