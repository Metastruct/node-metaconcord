import * as Discord from "discord.js";
import { SQL } from "@/app/services/SQL.js";
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
import DiscordConfig from "@/config/discord.json" with { type: "json" };
import crypto from "crypto";
import { verifyWebhookEventMiddleware } from "discord-interactions";
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * Discord login and linking. The OAuth grant is also what Linked Roles needs
 * (role_connections.write), so the tokens are kept in discord_tokens for
 * services/DiscordMetadata; the account itself lives in services/Accounts.
 */

const STATE_COOKIE = "clientState";

type AccessTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
};

type LocalDatabaseEntry = {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
};

type CurrentAuthorizationInformation = {
	application: Discord.APIApplication; // partial application missing?
	scopes: string[];
	expires: string;
	user: Discord.APIUser;
};

export const getOAuthURL = () => {
	const state = crypto.randomUUID();
	const url = new URL("https://discord.com/api/oauth2/authorize");
	url.searchParams.set("client_id", DiscordConfig.bot.applicationId);
	url.searchParams.set("redirect_uri", DiscordConfig.bot.oAuthCallbackUri);
	url.searchParams.set("response_type", "code");
	url.searchParams.set("state", state);
	url.searchParams.set("scope", "role_connections.write identify");
	url.searchParams.set("prompt", "consent");
	return { state, url: url.toString() };
};

const basicAuth =
	"Basic " +
	Buffer.from(DiscordConfig.bot.applicationId + ":" + DiscordConfig.bot.clientSecret).toString(
		"base64"
	);

export const getOAuthTokens = async (code: string) => {
	const res = await fetch("https://discord.com/api/v10/oauth2/token", {
		method: "POST",
		headers: { Authorization: basicAuth },
		body: new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: DiscordConfig.bot.oAuthCallbackUri,
		}),
	}).catch(err => {
		log.error(err, "failed fetching tokens");
	});
	if (res?.ok) return res.json() as Promise<AccessTokenResponse>;
};

export const revokeOAuthToken = async (token: string, localOnly?: boolean) => {
	const sql: SQL = globalThis.MetaConcord.container.getService("SQL");

	if (!localOnly) {
		const res = await fetch("https://discord.com/api/v10/oauth2/token/revoke", {
			method: "POST",
			headers: { Authorization: basicAuth },
			body: new URLSearchParams({
				token: token,
				token_type_hint: "access_token",
			}),
		}).catch(err => {
			log.error(err, "failed revoking token");
		});
		if (!res) return false;
	}

	await sql.getLocalDatabase().run("DELETE FROM discord_tokens WHERE access_token = ?", token);

	return true;
};

const avatarUrl = (user: Discord.APIUser): string | undefined =>
	user.avatar
		? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${user.avatar.startsWith("a_") ? "gif" : "png"}?size=256`
		: undefined;

export default async (webApp: WebApp): Promise<void> => {
	const sql = webApp.container.getService("SQL");
	const metadata = () => webApp.container.getService("DiscordMetadata");
	const secretLimiter = rateLimit({ keyGenerator: rateLimitKeyGenerator });

	const getAuthorizationData = async (tokens: AccessTokenResponse) => {
		const res = await fetch("https://discord.com/api/v10/oauth2/@me", {
			headers: { Authorization: `Bearer ${tokens.access_token}` },
		}).catch(err => {
			log.error(err, "failed fetching authorization data");
		});
		if (res?.ok) return res.json() as Promise<CurrentAuthorizationInformation>;
	};

	// the Linked Roles button on Discord points here, so does the site's login page
	webApp.app.get("/discord/link", async (req, res) => {
		const { state, url } = getOAuthURL();
		res.cookie(STATE_COOKIE, state, { ...cookieOptions, maxAge: 5 * 60 * 1000, signed: true });
		if (req.query.redirect) storeRedirect(webApp, req, res);
		res.redirect(url);
	});
	webApp.app.get("/auth/discord", (req, res) => {
		res.redirect(`/discord/link?${new URLSearchParams(req.query as Record<string, string>)}`);
	});

	webApp.app.get("/discord/link/:id", async (req, res) => {
		const data = await metadata().get(req.params.id);
		if (!data) {
			res.status(404).send("no data");
			return;
		}
		res.send(data);
	});
	webApp.app.get("/discord/link/:id/refresh", secretLimiter, async (req, res) => {
		try {
			res.send((await metadata().update(req.params.id)) ? "👌" : "👎");
		} catch (err) {
			log.error(err, "failed refreshing linked role metadata");
			res.status(502).send("👎");
		}
	});
	webApp.app.get("/discord/link/:id/revoke", secretLimiter, async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const result = await metadata().revoke(req.params.id);
		res.send(result ? "👌" : "no data");
	});

	webApp.app.post(
		"/discord/webhooks/deauthorized",
		verifyWebhookEventMiddleware(DiscordConfig.bot.publicKey),
		async (req, res) => {
			const eventBody = req.body as {
				event_type?: string;
				data?: { user_id?: string };
			};

			if (eventBody.event_type !== "APPLICATION_DEAUTHORIZED") {
				log.info({ type: eventBody.event_type }, "webhook non-deauthorized event");
				res.sendStatus(204);
				return;
			}

			const userId = eventBody.data?.user_id as string | undefined;
			if (!userId) {
				log.warn({ body: req.body }, "webhook missing user.id");
				res.sendStatus(400);
				return;
			}

			await metadata().revoke(userId);
			res.sendStatus(204);
		}
	);
	webApp.app.get("/discord/revokealltokens", secretLimiter, async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const entries = await sql
			.getLocalDatabase()
			.all<LocalDatabaseEntry[]>("SELECT access_token FROM discord_tokens");
		if (!entries || entries.length === 0) {
			res.status(404).send("no data");
			return;
		}
		for (const entry of entries) {
			await revokeOAuthToken(entry.access_token);
		}
		res.send("👌");
	});
	webApp.app.get("/discord/linkrefreshall", secretLimiter, async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const entries = await sql
			.getLocalDatabase()
			.all<LocalDatabaseEntry[]>("SELECT user_id FROM discord_tokens");
		for (const entry of entries ?? []) {
			await metadata().update(entry.user_id);
		}
		res.send("👌");
	});

	webApp.app.get("/discord/auth/callback", secretLimiter, async (req, res) => {
		const redirect = takeRedirect(webApp, req, res, `${webApp.config.siteUrl}/profile`);
		try {
			const code = req.query["code"];
			if (!code) {
				res.sendStatus(403);
				return;
			}
			const discordState = req.query["state"];
			const clientState = req.signedCookies?.[STATE_COOKIE];
			res.clearCookie(STATE_COOKIE, cookieOptions);
			if (!clientState || clientState !== discordState) {
				log.error(
					{ cookiePresent: !!clientState },
					clientState
						? "[OAuth Callback] State mismatch (cookie present, value differs)"
						: "[OAuth Callback] State mismatch (no clientState cookie - expired or dropped)"
				);
				res.sendStatus(403);
				return;
			}
			const tokens = await getOAuthTokens(code as string);
			if (!tokens) {
				res.sendStatus(500);
				return;
			}
			const data = await getAuthorizationData(tokens);
			if (!data) {
				res.sendStatus(500);
				return;
			}

			const user = data.user;
			let account;
			try {
				account = await webApp.container
					.getService("Accounts")
					.loginOrLink(getSessionAccountId(req), {
						provider: "discord",
						providerId: user.id,
						name: user.global_name || user.username,
						avatar: avatarUrl(user),
						source: "oauth",
					});
			} catch (err) {
				if (err instanceof LinkConflictError) {
					res.redirect(
						`${webApp.config.siteUrl}/profile?error=conflict&provider=discord`
					);
					return;
				}
				throw err;
			}
			setSessionCookie(res, account.id);

			const db = sql.getLocalDatabase();
			await db.exec(
				"CREATE TABLE IF NOT EXISTS discord_tokens (user_id VARCHAR(255) PRIMARY KEY, steam_id VARCHAR(255), access_token VARCHAR(255), refresh_token VARCHAR(255), expires_at DATETIME)"
			);
			await db.run(
				"INSERT INTO discord_tokens (user_id, access_token, refresh_token, expires_at) VALUES($user_id, $access_token, $refresh_token, $expires_at) ON CONFLICT (user_id) DO UPDATE SET access_token = $access_token, refresh_token = $refresh_token, expires_at = $expires_at",
				{
					$user_id: user.id,
					$access_token: tokens.access_token,
					$refresh_token: tokens.refresh_token,
					$expires_at: Date.now() + tokens.expires_in * 1000,
				}
			);

			// needs a Steam link on the account, the profile page says so when it is missing
			await metadata()
				.update(user.id)
				.catch(err => log.error(err, "linked role metadata update failed"));

			log.info(`discord login for ${user.username} (account ${account.id})`);
			res.redirect(redirect);
		} catch (err) {
			log.error(err);
			res.sendStatus(500);
		}
	});
};
