import { Container, Service } from "@/app/Container.js";
import type { App } from "@/app/index.js";
import OIDCProvider from "@/app/services/OIDC.js";
import SQLProvider, { SQL } from "@/app/services/SQL.js";
import WebAppProvider, { WebApp } from "@/app/services/webapp/index.js";
import { encrypt } from "@/app/services/webapp/secretBox.js";
import WebAppConfig from "@/config/webapp.json" with { type: "json" };
import OIDCConfig from "@/config/oidc.json" with { type: "json" };
import crypto from "crypto";

/**
 * Local integration test for the OIDC provider. Boots ONLY the services it
 * needs (SQL, WebApp, a fake Accounts, OIDC) into a standalone Container, so
 * nothing touches Discord, IRC, gamebridge or GitHub. Run with:
 *
 *   yarn test:oidc
 *
 * Which drives a real authorization-code flow over HTTP against the local
 * webapp, using a forged session cookie (the same AES-GCM one the site sets).
 */

// Keep the run isolated: throwaway sqlite db, localhost issuer, random cookie key.
process.env.METACONCORD_DB_PATH = "oidc-test.db";
const PORT = 8680;
(WebAppConfig as { port: number }).port = PORT;
// issuer on the (sub)domain root, endpoints at /oauth/* (what Fluxer's SSO
// expects); prod issuer is https://metaconcord.metastruct.net
OIDCConfig.issuer = `http://localhost:${PORT}`;
OIDCConfig.cookieKeys = process.env.OIDC_TEST_COOKIE_KEY ?? crypto.randomBytes(32).toString("hex");

const accountsStore = new Map(
	[1, 2].map(id => [
		id,
		{
			id,
			displayName: `Test User ${id}`,
			roles: ["developer"],
			sessionVersion: 1,
			// account 1 has a verified email, account 2 has none (unverified
			// Discord email, GitHub link predates email capture) and must get the
			// "needs a verified email" picker instead of a code the client rejects.
			links: [
				{
					provider: "discord",
					providerId: `9000${id}`,
					name: `disc${id}`,
					email: `user${id}@example.com`,
					emailVerified: id === 1,
				},
				{ provider: "github", providerId: String(1000 + id), name: `user${id}` },
			],
		},
	])
);

class FakeAccounts extends Service {
	name = "Accounts";
	async get(id: number) {
		return accountsStore.get(id);
	}
}

const container = new Container({} as App, [
	SQLProvider,
	WebAppProvider,
	(container: Container) => new FakeAccounts(container),
	OIDCProvider,
]);

const SESSION_COOKIE = "mcSession";
const sessionCookie = (accountId: number): string => {
	const account = accountsStore.get(accountId);
	const value = encrypt({
		accountId,
		version: account?.sessionVersion ?? 1,
		expiresAt: Date.now() + 60_000,
	});
	return `${SESSION_COOKIE}=${value}`;
};

/** Forges a provider session naming a (possibly deleted) account. */
const providerSession = async (accountId: number, value: string): Promise<void> => {
	const sql = container.getService("SQL") as SQL;
	await sql.database.run(
		"INSERT INTO oidc_tokens (id, grant_id, payload) VALUES (?, ?, ?)",
		value,
		null,
		JSON.stringify({
			payload: {
				// jti must match the row id, like a provider-saved session: without
				// it the model fabricates a new id and the reset lands on another row
				jti: value,
				iat: Math.floor(Date.now() / 1000),
				exp: Math.floor(Date.now() / 1000) + 3600,
				authorizations: {},
				accountId: String(accountId),
				uid: `uid-${accountId}`,
			},
		})
	);
};

const client = { ...OIDCConfig.clients[0] };
if (!client.client_secret) {
	// oidc-provider requires confidential clients to have a secret
	client.client_secret = crypto.randomBytes(24).toString("hex");
	OIDCConfig.clients[0].client_secret = client.client_secret;
}
const redirectUri = client.redirect_uris[0];

/** GET with a cookie jar that picks up Set-Cookie along the way. */
async function getWithCookies(url: URL | string, cookie?: string): Promise<Response> {
	const jar = new Map<string, string>();
	if (cookie)
		for (const part of cookie.split("; ")) jar.set(part.slice(0, part.indexOf("=")), part);
	let current = new URL(url);
	for (let hops = 0; hops < 5; hops++) {
		const res = await fetch(current, {
			redirect: "manual",
			headers: { cookie: [...jar.values()].join("; ") },
		});
		for (const set of res.headers.getSetCookie()) {
			const [pair] = set.split(";");
			const [name, value] = pair.split("=");
			jar.set(name, `${name}=${value}`);
		}
		const location = res.headers.get("location");
		if (!location || res.status >= 400) return res;
		const next = new URL(location, current);
		if (next.origin === new URL(redirectUri).origin) return res;
		current = next;
	}
	throw new Error("too many redirects");
}

async function followToCode(authUrl: URL, cookie?: string): Promise<URL> {
	let url = new URL(authUrl);
	const jar = new Map<string, string>();
	if (cookie)
		for (const part of cookie.split("; ")) jar.set(part.slice(0, part.indexOf("=")), part);
	for (let hops = 0; hops < 10; hops++) {
		const res = await fetch(url, {
			redirect: "manual",
			headers: { cookie: [...jar.values()].join("; ") },
		});
		// carry oidc-provider's interaction cookies through the hops
		for (const set of res.headers.getSetCookie()) {
			const [pair] = set.split(";");
			const [name, value] = pair.split("=");
			jar.set(name, `${name}=${value}`);
		}
		const location = res.headers.get("location");
		if (!location)
			throw new Error(`expected redirect at ${url}, got ${res.status}: ${await res.text()}`);
		url = new URL(location, url);
		if (url.origin === new URL(redirectUri).origin) return url;
	}
	throw new Error("too many redirects");
}

async function main(): Promise<void> {
	for (const provider of container.getProviders()) {
		container.addService(provider(container));
	}
	await container.initServices();
	const sql = container.getService("SQL") as SQL;

	let failures = 0;
	const check = (name: string, ok: boolean, detail = "") => {
		console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail ? `: ${detail}` : ""}`);
		if (!ok) failures++;
	};

	try {
		// 1. discovery
		const discovery = await (
			await fetch(`${OIDCConfig.issuer}/.well-known/openid-configuration`)
		).json();
		check(
			"discovery has Fluxer endpoints",
			discovery.authorization_endpoint === `${OIDCConfig.issuer}/oauth/authorize` &&
				discovery.token_endpoint === `${OIDCConfig.issuer}/oauth/token` &&
				discovery.userinfo_endpoint === `${OIDCConfig.issuer}/oauth/userinfo`
		);

		// 2. no session -> interaction shows the provider picker (the website's
		// /login page rendered inline, pointing back at the interaction)
		const authUrl = new URL(discovery.authorization_endpoint);
		authUrl.searchParams.set("response_type", "code");
		authUrl.searchParams.set("client_id", client.client_id);
		authUrl.searchParams.set("redirect_uri", redirectUri);
		// mirror Fluxer's default SSO scope (openid email profile)
		authUrl.searchParams.set("scope", "openid email profile");
		authUrl.searchParams.set("state", "st123");
		authUrl.searchParams.set("nonce", "no456");
		const loggedOut = await getWithCookies(authUrl);
		const pickerHtml = await loggedOut.text();
		const pickerLinks = [...pickerHtml.matchAll(/href="([^"]+)"/g)].map(m => m[1]);
		check(
			"no session shows provider picker",
			(loggedOut.headers.get("content-type") ?? "").includes("text/html") &&
				["discord", "github"].every(provider =>
					pickerLinks.some(
						href =>
							href.startsWith(`/auth/${provider}?redirect=`) &&
							href.includes("target=self")
					)
				) &&
				!["steam", "gitlab"].some(provider =>
					pickerLinks.some(href => href.includes(`/auth/${provider}?`))
				)
		);

		// 3. with a session cookie the whole flow resolves to a code
		const back = await followToCode(authUrl, sessionCookie(1));
		const code = back.searchParams.get("code");
		check("authorization code issued", !!code, back.searchParams.get("error") ?? "");

		// 4. code exchange -> id_token with the account's claims
		const tokenRes = await fetch(discovery.token_endpoint, {
			method: "POST",
			headers: {
				"content-type": "application/x-www-form-urlencoded",
				authorization: `Basic ${Buffer.from(`${client.client_id}:${client.client_secret}`).toString("base64")}`,
			},
			body: new URLSearchParams({
				grant_type: "authorization_code",
				code: code!,
				redirect_uri: redirectUri,
			}),
		});
		const tokens = (await tokenRes.json()) as {
			id_token?: string;
			access_token?: string;
			error?: string;
		};
		const idClaims = tokens.id_token
			? (JSON.parse(Buffer.from(tokens.id_token.split(".")[1], "base64url").toString()) as {
					sub: string;
				})
			: undefined;
		check("id_token subject", idClaims?.sub === "1", JSON.stringify(idClaims ?? tokens));

		// 4b. profile claims live on userinfo (conformIdTokenClaims keeps them out
		// of the id_token for code flow). Fluxer's SSO requires email +
		// email_verified:true and reads `name` for display/username derivation.
		const userinfo = (await (
			await fetch(`${OIDCConfig.issuer}/oauth/userinfo`, {
				headers: { authorization: `Bearer ${tokens.access_token}` },
			})
		).json()) as {
			sub?: string;
			name?: string;
			displayName?: string;
			preferred_username?: string;
			email?: string;
			email_verified?: boolean;
			roles?: string[];
			error?: string;
		};
		check(
			"fluxer-required claims",
			userinfo.sub === "1" &&
				userinfo.name === "Test User 1" &&
				userinfo.preferred_username === "Test User 1" &&
				// verified Discord email wins over the GitHub noreply fallback
				userinfo.email === "user1@example.com" &&
				userinfo.email_verified === true &&
				!!userinfo.roles?.length,
			JSON.stringify(userinfo)
		);

		// 5. adapter round trip: the interaction and grant landed in sqlite
		const rows = (await sql.database.all("SELECT id FROM oidc_tokens;")) as { id: string }[];
		check("adapter persisted state", rows.length >= 2, `${rows.length} rows`);

		// 6. an account without a verified email gets the "needs email" picker
		// instead of a code the client would reject
		const needsEmailRes = await getWithCookies(authUrl, sessionCookie(2));
		const needsEmailHtml = await needsEmailRes.text();
		check(
			"session without verified email shows picker",
			needsEmailHtml.includes("needs a login with a verified email") &&
				needsEmailHtml.includes("Continue with Discord")
		);

		// 7. a provider session naming a deleted account must not crash
		// /oauth/authorize with a 500, and the same browser (cookie jar) must be
		// able to log in again right after: findAccount resets the stale session
		// to logged-out instead of destroying it, so its uid survives and the
		// resume-time "authentication session mismatch" never happens
		const staleUid = `stale-${Date.now()}`;
		await providerSession(999, staleUid);
		const { default: KeyGrip } = await import("keygrip");
		const keys = new KeyGrip([OIDCConfig.cookieKeys]);
		const staleCookies = new Map<string, string>([
			["_session", `_session=${staleUid}`],
			["_session.sig", `_session.sig=${keys.sign(`_session=${staleUid}`)}`],
		]);
		const staleRes = await fetch(authUrl, {
			redirect: "manual",
			headers: { cookie: [...staleCookies.values()].join("; ") },
		});
		const staleLocation = new URL(staleRes.headers.get("location") ?? "", authUrl);
		check(
			"deleted account session gets a clean error, not a 500",
			staleRes.status < 500 &&
				staleLocation.searchParams.get("error") === "invalid_request" &&
				staleLocation.searchParams.get("error_description") === "account no longer exists",
			`status ${staleRes.status}`
		);

		// 7b. same browser, session now logged out: the flow resolves to a code
		// like any fresh login (this is what regressed with a destroy()-based fix)
		const recovered = await followToCode(
			authUrl,
			[...staleCookies.values(), sessionCookie(1)].join("; ")
		);
		check(
			"login works after stale session recovery",
			!!recovered.searchParams.get("code") && !recovered.searchParams.get("error"),
			recovered.searchParams.get("error_description") ?? ""
		);
	} finally {
		await sql.database.close();
		(container.getService("WebApp") as WebApp).http.close();
	}

	if (failures > 0) {
		console.error(`${failures} check(s) failed`);
		process.exitCode = 1;
	} else {
		console.log("all OIDC checks passed");
	}
}

main().catch(err => {
	console.error(err);
	process.exitCode = 1;
});
