import { Container, Service } from "../Container.js";
import { getSessionAccountId } from "./webapp/api/auth/session.js";
import { SQL } from "./SQL.js";
import { EMAIL_LOGIN_PROVIDERS } from "./Accounts.js";
import { logger } from "@/utils.js";
import OIDCConfig from "@/config/oidc.json" with { type: "json" };
import crypto from "node:crypto";
import {
	Provider as OIDCProvider,
	type Account,
	type AccountClaims,
	type Grant as OIDCGrant,
	type Adapter,
	type AdapterPayload,
	errors,
} from "oidc-provider";

const log = logger(import.meta);

/**
 * An OpenID Connect provider mounted on the WebApp, so other sites can log in
 * with the same metastruct account. The issuer is the site root, so the
 * endpoints land at /oauth/authorize, /oauth/token and /oauth/userinfo.
 * Identities come from the website session cookie (see webapp/api/auth/session),
 * state is stored in sqlite via SQL. Clients are declared in config/oidc.json,
 * no dynamic registration.
 */

type ClientConfig = {
	client_id: string;
	client_secret?: string;
	redirect_uris: string[];
	grant_types?: string[];
	response_types?: string[];
	scope?: string;
	post_logout_redirect_uris?: string[];
};

export class OIDC extends Service {
	name = "OIDC";
	config = OIDCConfig as {
		issuer: string;
		cookieKeys: string;
		clients: ClientConfig[];
		claims?: { displayName?: boolean; roles?: boolean; email?: boolean };
	};

	provider!: OIDCProvider;

	async init(): Promise<void> {
		const webApp = this.container.getService("WebApp");
		const sql = this.container.getService("SQL");
		const accounts = this.container.getService("Accounts");

		await this.ensureTables(sql);

		this.provider = new OIDCProvider(this.config.issuer, {
			adapter: makeAdapter(sql),
			clients: this.config.clients.map(client => ({
				...client,
				response_types: client.response_types as
					| (
							| "code"
							| "id_token"
							| "id_token token"
							| "code id_token"
							| "code token"
							| "code id_token token"
							| "none"
					  )[]
					| undefined,
			})),
			routes: {
				authorization: "/oauth/authorize",
				token: "/oauth/token",
				userinfo: "/oauth/userinfo",
				jwks: "/oauth/jwks",
				introspection: "/oauth/token/introspection",
				revocation: "/oauth/token/revocation",
				end_session: "/oauth/session/end",
			},
			claims: {
				profile: ["name", "displayName", "preferred_username", "roles"],
				email: ["email", "email_verified"],
			},
			extraTokenClaims: async (_ctx, token) =>
				"accountId" in token && token.accountId
					? { username: (await accounts.get(Number(token.accountId)))?.displayName }
					: undefined,
			findAccount: async (ctx, id): Promise<Account | undefined> => {
				const account = await accounts.get(Number(id));
				if (!account) {
					// The session can outlive deleted accounts. Resetting it to
					// logged-out (instead of destroying it) keeps its uid, so the
					// browser recovers without an "authentication session mismatch".
					const session = ctx.oidc?.session as Record<string, unknown> | undefined;
					if (session) {
						delete session.accountId;
						delete session.loginTs;
						delete session.amr;
						delete session.acr;
						delete session.authorizations;
						delete session.state;
						session.touched = true; // persisted by ensureSessionSave
					}
					throw new errors.SessionNotFound("account no longer exists");
				}
				return {
					accountId: id,
					claims: async (_use, scope): Promise<AccountClaims> => {
						// a verified email captured at OAuth login; accounts with none get
						// none, and clients that require one will reject the login.
						const verifiedEmail = account.links.find(
							link => link.emailVerified && link.email
						);
						const claims: AccountClaims = {
							sub: id,
							name: account.displayName,
							preferred_username: account.displayName,
							roles: account.roles,
						};
						if (scope?.includes("email") && this.config.claims?.email !== false) {
							if (verifiedEmail?.email) {
								claims.email = verifiedEmail.email;
								// some clients refuse logins unless this is explicitly true,
								// absent is not good enough
								claims.email_verified = true;
							}
						}
						return claims;
					},
				};
			},
			interactions: {
				// handled by the express route registered below
				url: (_ctx, interaction) => `/oauth/interaction/${interaction.uid}`,
			},
			features: {
				// interactions are handled by the route below, no built-in views
				devInteractions: { enabled: false },
			},
			renderError: async (ctx, out, error) => {
				log.error(
					{ err: error, out, query: ctx.query, client_id: ctx.query.client_id },
					`oidc error on ${ctx.path}`
				);
				ctx.type = "html";
				const esc = (value: unknown) =>
					String(value).replace(/[&<>"]/g, ch => `&#${ch.charCodeAt(0)};`);
				ctx.body =
					`<h1>SSO error</h1>` +
					`<p><code>${esc(out.error)}${out.error_description ? `: ${esc(out.error_description)}` : ""}</code></p>` +
					`<p>If this happened while logging in, the parameters the login site sent were rejected. ` +
					`Plain visits to this URL without parameters is expected to fail like this.</p>`;
			},
			cookies: {
				keys: [OIDCConfig.cookieKeys],
				short: { sameSite: "none" },
				long: {
					signed: true,
					sameSite: "lax",
					domain: ".metastruct.net",
				},
			},
			ttl: {
				Interaction: 60 * 60,
				Session: 30 * 24 * 60 * 60, // matches the webapp session cookie
				Grant: 30 * 24 * 60 * 60,
				AccessToken: 60 * 60,
				RefreshToken: 90 * 24 * 60 * 60,
				IdToken: 60 * 60,
				AuthorizationCode: 10 * 60,
			},
		});

		this.provider.proxy = true;

		// A stale _session cookie (a leftover host-only copy from before the
		// cookie gained its Domain attribute, or one the database no longer
		// resolves) shadows every fresh one, so logins keep failing with
		// "authentication session mismatch". The header can't say which variant
		// holds it, so scrub in two passes: host-only first, then the domain one.
		const secureCookies = this.config.issuer.startsWith("https:");
		const cookieDomain = ".metastruct.net"; // mirrors cookies.long.domain above
		const sessionSig = (value: string) =>
			crypto
				.createHmac("sha1", this.config.cookieKeys)
				.update(`_session=${value}`)
				.digest("base64")
				.replace(/\+/g, "-")
				.replace(/\//g, "_")
				.replace(/=+$/, "");
		const clearCookie = (name: string, domain?: string) =>
			`${name}=; path=/; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT; httpOnly` +
			(domain ? `; domain=${domain}` : "") +
			(secureCookies ? "; secure" : "");
		webApp.app.use("/oauth", async (req, res, next) => {
			try {
				// only navigations: token endpoints authenticate by credentials
				if (req.method !== "GET") return next();
				const attempt = Number(req.cookies?.__mcscrub ?? 0);
				const header = req.headers.cookie ?? "";
				const values = [...header.matchAll(/(?:^|; *)_session=([^;]*)/g)]
					.map(m => m[1])
					.filter(value => value !== "");
				if (values.length === 0) return next();
				const sigs = [...header.matchAll(/(?:^|; *)_session\.sig=([^;]*)/g)].map(m => m[1]);
				const sessionAdapter = this.provider.Session.adapter;
				const resolvable = await Promise.all(
					values.map(
						async value =>
							sigs.some(sig => sessionSig(value) === sig) &&
							!!(await sessionAdapter.find(value))
					)
				);
				if (resolvable.every(Boolean)) {
					// duplicates: oidc-provider reads only the first cookie, so drop
					// the shadowing host-only copy (the domain one holds the session)
					if (values.length > 1)
						res.append("Set-Cookie", [clearCookie("_session"), clearCookie("_session.sig")]);
					return next();
				}
				if (attempt >= 2) return next(); // give up, the error page says to retry
				log.info(
					{ cookies: values.length, attempt: attempt + 1 },
					`stale oidc session cookie on ${req.path}, scrubbing`
				);
				res.append(
					"Set-Cookie",
					attempt === 0
						? [clearCookie("_session"), clearCookie("_session.sig")]
						: [
								clearCookie("_session", cookieDomain),
								clearCookie("_session.sig", cookieDomain),
							]
				);
				res.cookie("__mcscrub", String(attempt + 1), {
					httpOnly: true,
					maxAge: 60_000,
					path: "/oauth",
				});
				res.redirect(req.originalUrl);
			} catch (err) {
				log.error(err, "oidc session cookie scrub failed");
				next();
			}
		});

		// Interaction endpoint, handled by express before the koa app below. The
		// webapp cookie-parser is active here, so the session cookie just works.
		webApp.app.get("/oauth/interaction/:uid", async (req, res) => {
			try {
				await this.provider.interactionDetails(req, res);
			} catch {
				res.status(410).type("html").send(expiredPage());
				return;
			}
			const accountId = getSessionAccountId(req);
			const interaction = (await this.provider.interactionDetails(req, res)) as unknown as {
				params: { client_id: string; scope?: string };
				prompt: {
					name: string;
					reasons: string[];
					details: { missingOIDCScope?: string[]; missingOIDCClaims?: string[] };
				};
			};
			const needsEmail = interaction.params.scope?.includes("email") ?? false;
			const account = accountId ? await accounts.get(accountId) : undefined;
			const hasEmail =
				!!account && account.links.some(link => link.emailVerified && link.email);
			if (!account || (needsEmail && !hasEmail)) {
				res.type("html").send(loginPickerPage(req.params.uid, !account));
				return;
			}
			try {
				const { prompt, params } = interaction;
				log.debug(
					`interaction ${req.params.uid}: prompt=${prompt.name} reasons=${prompt.reasons.join(",")} missing=${prompt.details.missingOIDCScope?.join(" ") ?? "-"}`
				);
				let result: { login: { accountId: string }; consent?: { grantId: string } };
				if (prompt.details.missingOIDCScope) {
					// the Grant class is instantiated per provider, only reachable off
					// the instance
					const Grant = this.provider.Grant as unknown as typeof OIDCGrant;
					const grant = new Grant({
						accountId: String(accountId),
						clientId: params.client_id,
					});
					grant.addOIDCScope(prompt.details.missingOIDCScope.join(" "));
					if (prompt.details.missingOIDCClaims) {
						grant.addOIDCClaims(prompt.details.missingOIDCClaims);
					}
					result = {
						login: { accountId: String(accountId) },
						consent: { grantId: await grant.save() },
					};
				} else {
					result = { login: { accountId: String(accountId) } };
				}
				await this.provider.interactionFinished(req, res, result, {
					mergeWithLastSubmission: true,
				});
			} catch (err) {
				log.error(err, `interaction ${req.params.uid} failed`);
				throw err;
			}
		});

		log.info(`OIDC provider mounted at ${this.config.issuer}`);
	}

	async start(): Promise<void> {
		const webApp = this.container.getService("WebApp");
		webApp.app.use(this.provider.callback());
	}

	async ensureTables(sql: SQL): Promise<void> {
		await sql.database.exec(`
			CREATE TABLE IF NOT EXISTS oidc_tokens (
				id TEXT PRIMARY KEY,
				grant_id TEXT,
				payload TEXT NOT NULL
			);
			CREATE TABLE IF NOT EXISTS oidc_uid_index (
				uid TEXT PRIMARY KEY,
				id TEXT NOT NULL
			);
		`);
	}
}

const LOGIN_PICKER_LABELS: Record<string, string> = {
	discord: "Discord",
	steam: "Steam",
	github: "GitHub",
	gitlab: "GitLab",
};

const LOGIN_PICKER_COLORS: Record<string, string> = {
	discord: "#5865f2",
	steam: "#1b2838",
	github: "#24292f",
	gitlab: "#e24329",
};

/**
 * Providers offered on the SSO login picker: only those whose login captures
 * a verified email, since SSO clients may require one.
 */
const SSO_LOGIN_PROVIDERS = EMAIL_LOGIN_PROVIDERS;

/** Shown when the interaction behind a login link has expired or was consumed. */
function expiredPage(): string {
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Login expired - Meta Construct</title>
	<style>
		body { font-family: "Open Sans", system-ui, sans-serif; font-size: 14px;
			background: #212121; color: #fefefe; margin: 0;
			display: grid; place-items: center; min-height: 100vh; }
		main { background: #4a4a4a; padding: 2rem 2.5rem; border-radius: 4px;
			width: min(24rem, 90vw); box-sizing: border-box; }
		h1 { font-size: 1.4rem; font-weight: 600; margin: 0 0 .5rem; }
		p { color: #eeeeee; font-size: .875rem; margin: 0; }
	</style>
</head>
<body>
	<main>
		<h1>Login expired</h1>
		<p>This login link is no longer valid. Go back to the site that sent you
		here and start the login again.</p>
	</main>
</body>
</html>`;
}

function loginPickerPage(uid: string, fresh = true): string {
	const uidSafe = /^[a-zA-Z0-9_-]+$/.test(uid) ? uid : "";
	const redirect = encodeURIComponent(`/oauth/interaction/${uidSafe}`);
	const buttons = SSO_LOGIN_PROVIDERS.map(
		provider =>
			`<a class="provider" style="background:${LOGIN_PICKER_COLORS[provider] ?? "#444"}" href="/auth/${provider}?redirect=${redirect}&target=self"><img src="/dashboard/static/icons/${provider}.svg" alt="" aria-hidden="true">Continue with ${LOGIN_PICKER_LABELS[provider] ?? provider}</a>`
	).join("\n\t\t");
	return `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8">
	<meta name="viewport" content="width=device-width, initial-scale=1">
	<title>Log in - Meta Construct</title>
	<link rel="preconnect" href="https://fonts.googleapis.com">
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;600&display=swap">
	<style>
		body { font-family: "Open Sans", system-ui, sans-serif; font-size: 14px;
			background: #212121; color: #fefefe; margin: 0;
			display: grid; place-items: center; min-height: 100vh; }
		main { background: #4a4a4a; padding: 2rem 2.5rem; border-radius: 4px;
			width: min(24rem, 90vw); box-sizing: border-box; }
		h1 { font-size: 1.6rem; font-weight: 600; margin: 0 0 .25rem; color: #fefefe; }
		h1::after { content: ""; display: block; width: 3rem; height: 3px;
			background: #0ce3ac; margin-top: .5rem; border-radius: 2px; }
		p { color: #eeeeee; font-size: .875rem; margin: .75rem 0 1.25rem; }
		.provider { display: flex; align-items: center; gap: .75rem;
			padding: .7rem 1rem; border-radius: 4px; border: none; margin-bottom: .7rem;
			color: #fff; text-decoration: none; font-size: 1rem; font-weight: 400; }
		.provider:hover { filter: brightness(1.15); }
		.provider img { width: 1.25rem; height: 1.25rem; flex: none; }
	</style>
</head>
<body>
	<main>
		<h1>Log in</h1>
		<p>${fresh ? "Pick any platform. Others can be linked afterwards from your profile." : "You are logged in, but this site needs a login with a verified email. Continue with one of these to link it to your account."}</p>
		${buttons}
	</main>
</body>
</html>`;
}

/**
 * Generic oidc-provider adapter backed by the local sqlite database. Token,
 * grant, session and interaction payloads are opaque JSON blobs; the provider
 * handles expiry and consumption itself inside those payloads.
 */
function makeAdapter(sql: SQL): new (name: string) => Adapter {
	return class SQLiteAdapter implements Adapter {
		constructor(public name: string) {}

		async upsert(id: string, payload: AdapterPayload, expiresIn: number): Promise<void> {
			const expiresAt = expiresIn ? Date.now() + expiresIn * 1000 : undefined;
			await sql.database.run(
				`INSERT INTO oidc_tokens (id, grant_id, payload) VALUES (?, ?, ?)
				 ON CONFLICT(id) DO UPDATE SET grant_id=excluded.grant_id, payload=excluded.payload;`,
				id,
				payload.grantId ?? null,
				JSON.stringify({ payload, expiresAt })
			);
			// sessions carry a uid that interactions and tokens resolve back through
			if (typeof payload.uid === "string") {
				await sql.database.run(
					`INSERT INTO oidc_uid_index (uid, id) VALUES (?, ?)
					 ON CONFLICT(uid) DO UPDATE SET id=excluded.id;`,
					payload.uid,
					id
				);
			}
		}

		async find(id: string): Promise<AdapterPayload | undefined> {
			const row = await sql.database.get<{ payload: string }>(
				"SELECT payload FROM oidc_tokens WHERE id = ?;",
				id
			);
			if (!row) return undefined;
			const { payload, expiresAt } = JSON.parse(row.payload);
			if (expiresAt && expiresAt < Date.now()) return undefined;
			return payload;
		}

		async destroy(id: string): Promise<void> {
			await sql.database.run("DELETE FROM oidc_uid_index WHERE id = ?;", id);
			await sql.database.run("DELETE FROM oidc_tokens WHERE id = ?;", id);
		}

		async consume(id: string): Promise<void> {
			const row = await sql.database.get<{ payload: string }>(
				"SELECT payload FROM oidc_tokens WHERE id = ?;",
				id
			);
			if (!row) return;
			const stored = JSON.parse(row.payload) as {
				payload: AdapterPayload;
				expiresAt?: number;
			};
			stored.payload.consumed = Math.floor(Date.now() / 1000);
			await sql.database.run(
				"UPDATE oidc_tokens SET payload = ? WHERE id = ?;",
				JSON.stringify(stored),
				id
			);
		}

		async findByUid(uid: string): Promise<AdapterPayload | undefined> {
			const row = await sql.database.get<{ id: string }>(
				"SELECT id FROM oidc_uid_index WHERE uid = ?;",
				uid
			);
			return row ? this.find(row.id) : undefined;
		}

		async revokeByGrantId(grantId: string): Promise<void> {
			await sql.database.run("DELETE FROM oidc_tokens WHERE grant_id = ?;", grantId);
		}

		async findByUserCode(): Promise<AdapterPayload | undefined> {
			return undefined; // device flow is not enabled
		}
	};
}

export default (container: Container): Service => {
	return new OIDC(container);
};
