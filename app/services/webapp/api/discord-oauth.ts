import * as Discord from "discord.js";
import { SQL } from "@/app/services/SQL.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimit } from "express-rate-limit";
import DiscordConfig from "@/config/discord.json" with { type: "json" };
import SteamID from "steamid";
import axios, { AxiosError } from "axios";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import { logger } from "@/utils.js";

const log = logger(import.meta);

type AccessTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
};

type LocalDatabaseEntry = {
	user_id: string;
	steam_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
};

type ConnectionObject = Discord.APIConnection;

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
	url.searchParams.set("scope", "role_connections.write identify connections");
	url.searchParams.set("prompt", "consent");
	return { state, url: url.toString() };
};

export const getOAuthTokens = async (code: any) => {
	const res = await axios
		.post<AccessTokenResponse>(
			"https://discord.com/api/v10/oauth2/token",
			new URLSearchParams({
				grant_type: "authorization_code",
				code,
				redirect_uri: DiscordConfig.bot.oAuthCallbackUri,
			}),
			{
				auth: {
					username: DiscordConfig.bot.applicationId,
					password: DiscordConfig.bot.clientSecret,
				},
			}
		)
		.catch((err: AxiosError<Discord.OAuthErrorData>) => {
			log.error(err, "failed fetching tokens");
		});
	if (res) return res.data;
};

export const revokeOAuthToken = async (token: string, localOnly?: boolean) => {
	const sql: SQL = await globalThis.MetaConcord.container.getService("SQL");

	if (!localOnly) {
		const res = await axios
			.post(
				"https://discord.com/api/v10/oauth2/token/revoke",
				new URLSearchParams({
					token: token,
					token_type_hint: "access_token",
				}),
				{
					auth: {
						username: DiscordConfig.bot.applicationId,
						password: DiscordConfig.bot.clientSecret,
					},
				}
			)
			.catch((err: AxiosError) => {
				log.error(err, "failed revoking token");
				return;
			});
		if (!res) return false;
	}

	(await sql.getLocalDatabase()).db.run(
		"DELETE FROM discord_tokens WHERE access_token = ?;",
		token
	);

	return true;
};

export default async (webApp: WebApp): Promise<void> => {
	const sql = await webApp.container.getService("SQL");
	const metadata = await webApp.container.getService("DiscordMetadata");

	const getAuthorizationData = async (tokens: AccessTokenResponse) => {
		const res = await axios
			.get<CurrentAuthorizationInformation>("https://discord.com/api/v10/oauth2/@me", {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			})
			.catch((err: AxiosError) => {
				log.error(err, "failed fetching authorization data");
			});
		if (res) return res.data;
	};

	const getConnections = async (tokens: AccessTokenResponse) => {
		const res = await axios
			.get<ConnectionObject[]>("https://discord.com/api/v10/users/@me/connections", {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			})
			.catch((err: AxiosError) => {
				log.error(err, "failed fetching user connections");
			});
		if (res) return res.data;
	};

	webApp.app.use(cookieParser(webApp.config.cookieSecret));

	webApp.app.get("/discord/link", async (req, res) => {
		const { state, url } = getOAuthURL();
		res.cookie("clientState", state, { maxAge: 1000 * 60 * 5, signed: true });

		res.redirect(url);
	});
	webApp.app.get("/discord/link/:id", async (req, res) => {
		const data = await metadata.get(req.params.id);
		if (!data) {
			res.status(404).send("no data");
			return;
		}
		res.send(data);
	});
	webApp.app.get("/discord/link/:id/refresh", rateLimit(), async (req, res) => {
		res.send((await metadata.update(req.params.id)) ? "👌" : "👎");
	});
	webApp.app.get("/discord/link/:id/revoke", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const entry = await (
			await sql.getLocalDatabase()
		).get<LocalDatabaseEntry>(
			"SELECT access_token FROM discord_tokens WHERE user_id = ?",
			req.params.id
		);
		if (!entry) {
			res.status(404).send("no data");
			return;
		}
		await revokeOAuthToken(entry.access_token);
		res.send("👌");
	});
	webApp.app.get("/discord/revokealltokens", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const entries = await (
			await sql.getLocalDatabase()
		).all<LocalDatabaseEntry[]>("SELECT access_token FROM discord_tokens");
		if (!entries || entries.length === 0) {
			res.status(404).send("no data");
			return;
		}
		for (const entry of entries) {
			await revokeOAuthToken(entry.access_token);
		}
		res.send("👌");
	});
	webApp.app.get("/discord/linkrefreshall", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) {
			res.sendStatus(403);
			return;
		}
		const entries = await (
			await sql.getLocalDatabase()
		).all<LocalDatabaseEntry[]>("SELECT user_id FROM discord_tokens");
		if (!entries || entries.length === 0)
			for (const entry of entries) {
				await metadata.update(entry.user_id);
			}
		res.send("👌");
	});
	webApp.app.get("/discord/auth/callback", rateLimit(), async (req, res) => {
		try {
			const code = req.query["code"];
			if (!code) {
				res.sendStatus(403);
				return;
			}
			const discordState = req.query["state"];
			const { clientState } = req.signedCookies;
			if (clientState !== discordState) {
				log.error("[OAuth Callback] State mismatch?");
				res.sendStatus(403);
				return;
			}
			const tokens = await getOAuthTokens(code);
			if (!tokens) {
				res.sendStatus(500);
				return;
			}
			const data = await getAuthorizationData(tokens);
			if (!data) {
				res.sendStatus(500);
				return;
			}

			const userId = data.user.id;
			const db = await sql.getLocalDatabase();
			await db.exec(
				"CREATE TABLE IF NOT EXISTS discord_tokens (user_id VARCHAR(255) PRIMARY KEY, steam_id VARCHAR(255), access_token VARCHAR(255), refresh_token VARCHAR(255), expires_at DATETIME)"
			);
			let steamId: string | undefined;
			let selectedId: string | undefined;
			const connections = await getConnections(tokens);
			if (connections) {
				const steamProvider = connections.find(
					provider => provider.type === "steam" && provider.verified === true
				);
				if (steamProvider) {
					steamId = steamProvider.id;
				} else {
					const links = await sql.queryPool(
						`SELECT * FROM discord_link WHERE discorduserid = $1;`,
						[userId]
					);
					if (links.length === 0) {
						res.send(
							`<p>Steam not linked on Discord, please click on the button below to start linking here instead.</p> <a href="/steam/link/${userId}"><img src="https://community.cloudflare.steamstatic.com/public/images/signinthroughsteam/sits_02.png">`
						);
						return;
					}
					const selected = SteamID.fromIndividualAccountID(
						links[0].accountid
					).getSteamID64();
					if (links.length > 1) selectedId = selected;
					steamId = selected;
				}

				if (!steamId) {
					res.status(500).send("Could not get your SteamID :(");
					return;
				}

				await db.run(
					"INSERT INTO discord_tokens VALUES($user_id, $steam_id, $access_token, $refresh_token, $expires_at) ON CONFLICT (user_id) DO UPDATE SET steam_id = $steam_id, access_token = $access_token, refresh_token = $refresh_token, expires_at = $expires_at",
					{
						$user_id: userId,
						$steam_id: steamId,
						$access_token: tokens.access_token,
						$refresh_token: tokens.refresh_token,
						$expires_at: Date.now() + tokens.expires_in * 1000,
					}
				);

				await metadata.update(userId);

				res.send(
					"👍" +
						(selectedId
							? ` ⚠ since you seem to have more than one SteamID linked (wtf) I just picked the first one (https://steamcommunity.com/id/${selectedId}) ⚠`
							: "")
				);
			}
		} catch (err) {
			log.error(err);
			res.sendStatus(500);
		}
	});
};
