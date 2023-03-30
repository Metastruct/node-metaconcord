import { SQL } from "../../SQL";
import { WebApp } from "..";
import { rateLimit } from "express-rate-limit";
import DiscordConfig from "@/config/discord.json";
import SteamID from "steamid";
import axios, { AxiosError } from "axios";
import cookieParser from "cookie-parser";
import crypto from "crypto";
import discord from "discord.js";

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

type ConnectionObject = discord.APIConnection;

type CurrentAuthorizationInformation = {
	application: discord.APIApplication; // partial application missing?
	scopes: string[];
	expires: string;
	user: discord.APIUser;
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
				client_id: DiscordConfig.bot.applicationId,
				client_secret: DiscordConfig.bot.clientSecret,
				grant_type: "authorization_code",
				code,
				redirect_uri: DiscordConfig.bot.oAuthCallbackUri,
			})
		)
		.catch((err: AxiosError<discord.OAuthErrorData>) => {
			console.error(
				`[OAuth Callback] failed fetching tokens: [${err.code}] ${JSON.stringify(
					err.response?.data
				)}`
			);
		});
	if (res) return res.data;
};

export const revokeOAuthToken = async (token: string, localOnly?: boolean) => {
	const sql: SQL = globalThis.MetaConcord.container.getService("SQL");
	if (!sql) return false;

	if (!localOnly) {
		const res = await axios
			.post(
				"https://discord.com/api/v10/oauth2/token/revoke",
				new URLSearchParams({
					client_id: DiscordConfig.bot.applicationId,
					client_secret: DiscordConfig.bot.clientSecret,
					token: token,
				})
			)
			.catch((err: AxiosError) => {
				console.error(
					`[OAuth Callback] failed revoking tokens: [${err.code}] ${JSON.stringify(
						err.response?.data
					)}`
				);
			});
		if (!res) return false;
	}

	(await sql.getLocalDatabase()).db.run(
		"DELETE FROM discord_tokens WHERE access_token = ?;",
		token
	);

	return true;
};

export default (webApp: WebApp): void => {
	const sql = webApp.container.getService("SQL");
	const metadata = webApp.container.getService("DiscordMetadata");
	if (!sql || !metadata) return;

	const getAuthorizationData = async (tokens: AccessTokenResponse) => {
		const res = await axios
			.get<CurrentAuthorizationInformation>("https://discord.com/api/v10/oauth2/@me", {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			})
			.catch((err: AxiosError) => {
				console.error(
					`[OAuth] failed fetching user data: [${err.code}] ${JSON.stringify(
						err.response?.data
					)}`
				);
			});
		if (res) return res.data;
	};

	const getConnections = async (tokens: AccessTokenResponse) => {
		const res = await axios
			.get<ConnectionObject[]>("https://discord.com/api/v10/users/@me/connections", {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			})
			.catch((err: AxiosError) => {
				console.error(
					`[OAuth] failed fetching user connection data: [${err.code}] ${JSON.stringify(
						err.response?.data
					)}`
				);
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
		if (!data) return res.status(404).send("no data");
		res.send(data);
	});
	webApp.app.get("/discord/link/:id/refresh", rateLimit(), async (req, res) => {
		res.send((await metadata.update(req.params.id)) ? "👌" : "👎");
	});
	webApp.app.get("/discord/link/:id/revoke", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
		const entry = await (
			await sql.getLocalDatabase()
		).get<LocalDatabaseEntry>(
			"SELECT access_token FROM discord_tokens WHERE user_id = ?",
			req.params.id
		);
		if (!entry) return res.status(404).send("no data");
		await revokeOAuthToken(entry.access_token);
		res.send("👌");
	});
	webApp.app.get("/discord/revokealltokens", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
		const entries = await (
			await sql.getLocalDatabase()
		).all<LocalDatabaseEntry[]>("SELECT access_token FROM discord_tokens");
		if (!entries || entries.length === 0) return res.status(404).send("no data");
		for (const entry of entries) {
			await revokeOAuthToken(entry.access_token);
		}
		res.send("👌");
	});
	webApp.app.get("/discord/linkrefreshall", rateLimit(), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
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
			if (!code) return res.sendStatus(403);
			const discordState = req.query["state"];
			const { clientState } = req.signedCookies;
			if (clientState !== discordState) {
				console.error("[OAuth Callback] State mismatch?");
				return res.sendStatus(403);
			}
			const tokens = await getOAuthTokens(code);
			if (!tokens) return res.sendStatus(500);
			const data = await getAuthorizationData(tokens);
			if (!data) return res.sendStatus(500);

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
					if (links.length === 0)
						return res.send(
							`<p>Steam not linked on Discord, please click on the button below to start linking here instead.</p> <a href="/steam/link/${userId}"><img src="https://community.cloudflare.steamstatic.com/public/images/signinthroughsteam/sits_02.png">`
						);
					const selected = SteamID.fromIndividualAccountID(
						links[0].accountid
					).getSteamID64();
					if (links.length > 1) selectedId = selected;
					steamId = selected;
				}

				if (!steamId) return res.status(500).send("Could get not your SteamID :(");

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
			console.error(err);
			res.sendStatus(500);
		}
	});
};
