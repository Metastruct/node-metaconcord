import { WebApp } from "..";
import { rateLimit } from "express-rate-limit";
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

export default (webApp: WebApp): void => {
	const bot = webApp.container.getService("DiscordBot");
	const sql = webApp.container.getService("SQL");
	const metadata = webApp.container.getService("DiscordMetadata");
	if (!bot || !sql || !metadata) return;

	const getOAuthURL = () => {
		const state = crypto.randomUUID();
		const url = new URL("https://discord.com/api/oauth2/authorize");
		url.searchParams.set("client_id", bot.config.applicationId);
		url.searchParams.set("redirect_uri", bot.config.OAuthCallbackUri);
		url.searchParams.set("response_type", "code");
		url.searchParams.set("state", state);
		url.searchParams.set("scope", "role_connections.write identify connections");
		url.searchParams.set("prompt", "consent");
		return { state, url: url.toString() };
	};

	const getOAuthTokens = async (code: any) => {
		const res = await axios
			.post<AccessTokenResponse>(
				"https://discord.com/api/v10/oauth2/token",
				new URLSearchParams({
					client_id: bot.config.applicationId,
					client_secret: bot.config.clientSecret,
					grant_type: "authorization_code",
					code,
					redirect_uri: bot.config.OAuthCallbackUri,
				})
			)
			.catch((err: AxiosError) => {
				console.error(
					`[OAuth Callback] failed fetching tokens: [${err.code}] ${err.message}`
				);
			});
		if (res) return res.data;
	};

	const revokeOAuthToken = async (token: string) => {
		const res = await axios
			.post(
				"https://discord.com/api/v10/oauth2/token/revoke",
				new URLSearchParams({
					client_id: bot.config.applicationId,
					client_secret: bot.config.clientSecret,
					token: token,
				})
			)
			.catch((err: AxiosError) => {
				console.error(
					`[OAuth Callback] failed revoking tokens: [${err.code}] ${err.message}`
				);
			});
		if (res) return res.data;
	};

	const getAuthorizationData = async (tokens: AccessTokenResponse) => {
		const res = await axios
			.get<CurrentAuthorizationInformation>("https://discord.com/api/v10/oauth2/@me", {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			})
			.catch((err: AxiosError) => {
				console.error(`[OAuth] failed fetching user data: [${err.code}] ${err.message}`);
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
					`[OAuth] failed fetching user connection data: [${err.code}] ${err.message}`
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
		const db = await (
			await sql.getLocalDatabase()
		).get<LocalDatabaseEntry>("SELECT * FROM discord_tokens where user_id = ?;", req.params.id);
		if (!data || !db) return res.status(404).send("no data");
		res.send({ accountid: new SteamID(db.steam_id).accountid, ...data });
	});
	webApp.app.get("/discord/link/:id/refresh", rateLimit({ max: 5 }), async (req, res) => {
		await metadata.update(req.params.id);
		res.send("👌");
	});
	webApp.app.get("/discord/link/:id/revoke", rateLimit({ max: 5 }), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
		const db = await (
			await sql.getLocalDatabase()
		).get<LocalDatabaseEntry>("SELECT * FROM discord_tokens where user_id = ?;", req.params.id);
		if (!db) return res.status(404).send("no data");
		await revokeOAuthToken(db.access_token);
		res.send("👌");
	});
	webApp.app.get("/discord/linkrefreshall", rateLimit({ max: 5 }), async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
		const db = await (await sql.getLocalDatabase()).all("SELECT user_id FROM discord_tokens");
		for (const entry of db) {
			await metadata.update(entry.user_id);
		}
		res.send("👌");
	});
	webApp.app.get("/discord/auth/callback", async (req, res) => {
		try {
			const db = await sql.getLocalDatabase();
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

			await db.exec(
				"CREATE TABLE IF NOT EXISTS discord_tokens (user_id VARCHAR(255) PRIMARY KEY, steam_id VARCHAR(255), access_token VARCHAR(255), refresh_token VARCHAR(255), expires_at DATETIME);"
			);

			const connections = await getConnections(tokens);
			if (!connections) {
				return res.status(500).send("Could not get connections :(");
			}
			const steamProvider = connections.find(
				provider => provider.type === "steam" && provider.verified === true
			);
			if (!steamProvider) return res.status(403).send("Missing Steam connection :(");

			await db.run(
				"INSERT INTO discord_tokens VALUES($user_id, $steam_id, $access_token, $refresh_token, $expires_at) ON CONFLICT (user_id) DO UPDATE SET steam_id = $steam_id, access_token = $access_token, refresh_token = $refresh_token, expires_at = $expires_at",
				{
					$user_id: userId,
					$steam_id: steamProvider.id,
					$access_token: tokens.access_token,
					$refresh_token: tokens.refresh_token,
					$expires_at: Date.now() + tokens.expires_in * 1000,
				}
			);

			await metadata.update(userId);

			res.send("👍");
		} catch (err) {
			console.error(err);
			res.sendStatus(500);
		}
	});
};
