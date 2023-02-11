import { WebApp } from "..";
import { isAdmin } from "@/utils";
import SteamID from "steamid";
import axios from "axios";
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

type MetaDatabaseEntry = {
	accountid: number;
	discorduserid: string;
	linked_at: string;
};

type ClientAccessTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	scope: string;
};

type ConnectionObject = discord.APIConnection;

type CurrentAuthorizationInformation = {
	application: discord.APIApplication; // partial application missing?
	scopes: string[];
	expires: string;
	user: discord.APIUser;
};

enum ApplicationRoleConnectionMetadataType {
	INTEGER_LESS_THAN_OR_EQUAL = 1,
	INTEGER_GREATER_THAN_OR_EQUAL,
	INTEGER_EQUAL,
	INTEGER_NOT_EQUAL,
	DATETIME_LESS_THAN_OR_EQUAL,
	DATETIME_GREATER_THAN_OR_EQUAL,
	BOOLEAN_EQUAL,
	BOOLEAN_NOT_EQUAL,
}
type ApplicationRoleConnectionMetadata = {
	type: ApplicationRoleConnectionMetadataType;
	key: string;
	name: string;
	description: string;
};

type MetaMetadata = {
	admin?: boolean;
	coins?: number;
	time?: number; // playtime
};

type ApplicationRoleConnectionObject = {
	platform_name?: string;
	platfrom_username?: string;
	metadata: MetaMetadata;
};

export default (webApp: WebApp): void => {
	const bot = webApp.container.getService("DiscordBot");
	const sql = webApp.container.getService("SQL");
	if (!bot || !sql) return;

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
		const res = await axios.post<AccessTokenResponse>(
			"https://discord.com/api/v10/oauth2/token",
			new URLSearchParams({
				client_id: bot.config.applicationId,
				client_secret: bot.config.clientSecret,
				grant_type: "authorization_code",
				code,
				redirect_uri: bot.config.OAuthCallbackUri,
			})
		);
		if (res.status === 200) return res.data;
		else
			console.error(
				`[OAuth Callback] failed fetching tokens: [${res.status}] ${res.statusText}`
			);
	};

	const getAccessToken = async (userId: string, data: LocalDatabaseEntry) => {
		if (Date.now() > data.expires_at) {
			const res = await axios.post<AccessTokenResponse>(
				"https://discord.com/api/v10/oauth2/token",
				new URLSearchParams({
					client_id: bot.config.applicationId,
					client_secret: bot.config.clientSecret,
					grant_type: "refresh_token",
					refresh_token: data.refresh_token,
				})
			);
			if (res.status === 200) {
				const token = res.data;
				await (
					await sql.getLocalDatabase()
				).run(
					"UPDATE discord_tokens SET access_token = $access_token, refresh_token = $refresh_token, expires_at = $expires_at WHERE user_id = $user_id",
					{
						$user_Id: userId,
						$access_token: token.access_token,
						$refresh_token: token.refresh_token,
						$expires_at: Date.now() + token.expires_in * 1000,
					}
				);
				return token.access_token;
			} else
				console.error(
					`[OAuth Callback] failed fetching tokens: [${res.status}] ${res.statusText}`
				);
		}
		return data.access_token;
	};

	const getAuthorizationData = async (tokens: AccessTokenResponse) => {
		const res = await axios.get<CurrentAuthorizationInformation>(
			"https://discord.com/api/v10/oauth2/@me",
			{
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			}
		);
		if (res.status === 200) return res.data;
		else console.error(`[OAuth] failed fetching user data: [${res.status}] ${res.statusText}`);
	};

	const getConnections = async (tokens: AccessTokenResponse) => {
		const res = await axios.get<ConnectionObject[]>(
			"https://discord.com/api/v10/users/@me/connections",
			{
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			}
		);
		if (res.status === 200) return res.data;
		else
			console.error(
				`[OAuth] failed fetching user connection data: [${res.status}] ${res.statusText}`
			);
	};

	const pushMetadata = async (
		userId: string,
		data: LocalDatabaseEntry,
		metadata: MetaMetadata,
		userName?: string
	) => {
		const url = `https://discord.com/api/v10/users/@me/applications/${bot.config.applicationId}/role-connection`;
		const accessToken = await getAccessToken(userId, data);

		const res = await axios.put(
			url,
			{ platform_name: "Metastruct", platform_username: userName, metadata },
			{
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			}
		);
		if (res.status !== 200)
			console.error(`Error pushing discord metadata: [${res.status}] ${res.statusText}`);
	};

	const getMetadata = async (userId: string) => {
		const url = `https://discord.com/api/v10/users/@me/applications/${bot.config.applicationId}/role-connection`;
		const db = await sql.getLocalDatabase();
		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens where user_id = ?;",
			userId
		);
		if (!data) return;
		const accessToken = await getAccessToken(userId, data);

		const res = await axios.get<ApplicationRoleConnectionObject>(url, {
			headers: {
				Authorization: `Bearer ${accessToken}`,
			},
		});
		if (res.status === 200) return res.data;
		else console.error(`Error getting discord metadata: [${res.status}] ${res.statusText}`);
	};

	const updateMetadata = async (userId: string) => {
		const db = await sql.getLocalDatabase();

		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens where user_id = ?;",
			userId
		);
		if (!data) return;

		await sql.queryPool(
			"INSERT INTO discord_link (accountid, discorduserid, linked_at) VALUES($1, $2, $3) ON CONFLICT (accountid) DO UPDATE SET linked_at = $3",
			[new SteamID(data.steam_id).accountid, data?.user_id, new Date()]
		);

		const query1 = await sql.queryPool(`SELECT coins FROM coins WHERE accountid = $1;`, [
			new SteamID(data.steam_id).accountid,
		]);
		const query2 = await sql.queryPool(
			"SELECT SUM(totaltime) from playingtime WHERE accountid = $1;",
			[new SteamID(data.steam_id).accountid]
		);
		const query3 = await sql.queryPool(
			"SELECT value from kv WHERE key = $1 AND scope = 'meta_name'",
			[data.steam_id]
		);
		const coins: number = query1[0]?.coins;
		const playtime: string = query2[0]?.sum;
		const nick: Buffer = query3[0]?.value;

		const bridge = webApp.container.getService("GameBridge");
		if (!bridge) return;

		const metadata: MetaMetadata = {
			admin: await isAdmin(data.steam_id),
			time: isNaN(parseInt(playtime)) ? undefined : Math.round(parseInt(playtime) / 60 / 60),
			coins: coins,
		};
		await pushMetadata(
			userId,
			data,
			metadata,
			nick ? nick.toString("utf-8").replace(/<[^>]*>/g, "") : undefined
		);
	};

	webApp.app.use(cookieParser(webApp.config.cookieSecret));

	webApp.app.get("/discord/link", async (req, res) => {
		const { state, url } = getOAuthURL();
		res.cookie("clientState", state, { maxAge: 1000 * 60 * 5, signed: true });

		res.redirect(url);
	});
	webApp.app.get("/discord/link/:id", async (req, res) => {
		const data = await getMetadata(req.params.id);
		const db = await (
			await sql.getLocalDatabase()
		).get<LocalDatabaseEntry>("SELECT * FROM discord_tokens where user_id = ?;", req.params.id);
		if (!data || !db) return;
		res.send({ accountid: new SteamID(db.steam_id).accountid, ...data });
	});
	webApp.app.get("/discord/link/:id/refresh", async (req, res) => {
		await updateMetadata(req.params.id);
		res.send("👌");
	});
	webApp.app.get("/discord/linkrefreshall", async (req, res) => {
		const secret = req.query.secret;
		if (secret !== webApp.config.cookieSecret) return res.sendStatus(403);
		const db = await (await sql.getLocalDatabase()).all("SELECT user_id FROM discord_tokens");
		for (const entry of db) {
			await updateMetadata(entry.user_id);
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
			if (!steamProvider) return res.status(404).send("Missing Steam connection :(");

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

			await updateMetadata(userId);

			res.send("👍");
		} catch (err) {
			console.error(err);
			res.sendStatus(500);
		}
	});
};
