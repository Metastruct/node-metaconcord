import { Bans, DiscordBot, SQL } from "./index.js";
import { Container, Service } from "../Container.js";
import { DiscordErrorData, OAuthErrorData } from "discord.js";
import { isAdmin } from "@/utils.js";
import { revokeOAuthToken } from "./webapp/api/discord-oauth.js";
import SteamID from "steamid";
import axios, { AxiosError } from "axios";
import config from "@/config/metadata.json" assert { type: "json" };

export type MetaMetadata = {
	banned?: 1 | 0;
	dev?: 1 | 0;
	coins?: number;
	time?: number; // playtime
};

type AccessTokenResponse = {
	access_token: string;
	token_type: string;
	expires_in: number;
	refresh_token: string;
	scope: string;
};

export type ApplicationRoleConnectionObject = {
	platform_name?: string;
	platfrom_username?: string;
	metadata: MetaMetadata;
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
// for refrence
// eslint-disable-next-line @typescript-eslint/no-unused-vars
type ApplicationRoleConnectionMetadata = {
	type: ApplicationRoleConnectionMetadataType;
	key: string;
	name: string;
	description: string;
};

type LocalDatabaseEntry = {
	user_id: string;
	steam_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
};

type CachedUser = {
	steamId: string;
	discordId: string;
};

export class DiscordMetadata extends Service {
	name = "DiscordMetadata";
	private ARCOCache: Record<string, ApplicationRoleConnectionObject> = {};
	private UserCache: CachedUser[] = [];
	private sql: SQL;
	private bot: DiscordBot;
	private bans: Bans;

	constructor(container: Container) {
		super(container);
		this.initServices();
	}

	private async initServices() {
		this.sql = await this.container.getService("SQL");
		this.bot = await this.container.getService("DiscordBot");
		this.bans = await this.container.getService("Bans");
	}

	private async getAccessToken(userId: string, data: LocalDatabaseEntry) {
		if (Date.now() > data.expires_at) {
			const res = await axios
				.post<AccessTokenResponse>(
					"https://discord.com/api/v10/oauth2/token",
					new URLSearchParams({
						grant_type: "refresh_token",
						refresh_token: data.refresh_token,
					}),
					{
						auth: {
							username: this.bot.config.bot.applicationId,
							password: this.bot.config.bot.clientSecret,
						},
					}
				)
				.catch(async (err: AxiosError<OAuthErrorData>) => {
					const discordResponse = err.response?.data;
					if (discordResponse?.error === "invalid_grant") {
						// The provided authorization grant or refresh token is
						// invalid, expired, revoked, doesn't match redirection
						// URI, or was issued to another client.
						const res = await revokeOAuthToken(data.access_token);
						console.warn(
							`[Metadata] InValID_GraNT revoking token (${res})! ${userId} [${
								err.code
							}] ${JSON.stringify(discordResponse)}`
						);
					} else {
						console.error(
							`[Metadata] failed fetching tokens: [${err.code}] ${JSON.stringify(
								discordResponse
							)}`
						);
					}
				});

			if (res && "data" in res) {
				const token = res.data;
				const db = await this.sql.getLocalDatabase();
				await db.run(
					"UPDATE discord_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?",
					[
						token.access_token,
						token.refresh_token,
						Date.now() + token.expires_in * 1000,
						userId,
					]
				);
				return token.access_token;
			}
			console.error(
				`[Metadata] failed to get access token for ${userId} data: ${JSON.stringify(
					data
				)} res: ${JSON.stringify(res)}`
			);
		}

		return data.access_token;
	}

	async get(userId: string) {
		if (!this.ARCOCache[userId]) {
			const url = `https://discord.com/api/v10/users/@me/applications/${this.bot.config.bot.applicationId}/role-connection`;
			const db = await this.sql.getLocalDatabase();
			const data = await db.get<LocalDatabaseEntry>(
				"SELECT * FROM discord_tokens where user_id = ?;",
				userId
			);
			if (!data) return;
			const accessToken = await this.getAccessToken(userId, data);
			if (!accessToken) return;

			const res = await axios
				.get<ApplicationRoleConnectionObject>(url, {
					headers: {
						Authorization: `Bearer ${accessToken}`,
					},
				})
				.catch((err: AxiosError<DiscordErrorData>) => {
					console.error(
						`[Metadata] failed getting discord metadata: [${err.code}] ${JSON.stringify(
							err.response?.data
						)}`
					);
				});
			if (res) {
				this.ARCOCache[userId] = res.data;
				return res.data;
			}
		} else {
			return this.ARCOCache[userId];
		}
	}

	async update(userId: string) {
		const db = await this.sql.getLocalDatabase();

		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens WHERE user_id = ?;",
			userId
		);
		if (!data) return false;

		await this.sql.queryPool(
			"INSERT INTO discord_link (accountid, discorduserid, linked_at) VALUES($1, $2, $3) ON CONFLICT (accountid) DO UPDATE SET linked_at = $4",
			[new SteamID(data.steam_id).accountid, data.user_id, new Date(), new Date()]
		);

		const query1 = await this.sql.queryPool(`SELECT coins FROM coins WHERE accountid = $1;`, [
			new SteamID(data.steam_id).accountid,
		]);
		const query2 = await this.sql.queryPool(
			"SELECT SUM(totaltime) from playingtime WHERE accountid = $1;",
			[new SteamID(data.steam_id).accountid]
		);
		const query3 = await this.sql.queryPool(
			"SELECT value from kv WHERE key = $1 AND scope = 'meta_name'",
			[data.steam_id]
		);
		const coins: number = query1[0]?.coins;
		const playtime: string = query2[0]?.sum;
		const bytea: Buffer = query3[0]?.value;
		let nick: string | undefined;

		if (query3[0]) {
			nick = bytea.toString("utf-8").replace(/<[^>]*>/g, "");
		} else {
			const steam = await this.bot.container.getService("Steam");
			const summary = await steam.getUserSummaries(data.steam_id);
			nick = summary?.personaname;
		}

		const discordUser = await this.bot.getGuildMember(userId);

		const banned =
			(await this.bans.getBan(data.steam_id, true))?.b ||
			discordUser?.roles.cache.hasAny(...config.banned_roles);

		const metadata: MetaMetadata = {
			banned: banned ? 1 : 0,
			dev: (await isAdmin(data.steam_id)) ? 1 : 0,
			time: isNaN(parseInt(playtime)) ? undefined : Math.round(parseInt(playtime) / 60 / 60),
			coins: coins,
		};
		const res = await this.push(userId, data, metadata, nick);
		return res;
	}
	private async push(
		userId: string,
		data: LocalDatabaseEntry,
		metadata: MetaMetadata,
		userName?: string
	) {
		const url = `https://discord.com/api/v10/users/@me/applications/${this.bot.config.bot.applicationId}/role-connection`;
		const accessToken = await this.getAccessToken(userId, data);
		const body = { platform_name: "Metastruct", platform_username: userName, metadata };

		if (!accessToken) {
			console.error(
				`[Metadata] failed pushing discord metadata invalid Accesstoken?: ${userName}(${userId})`
			);
			return false;
		}

		await axios
			.put(url, body, {
				headers: {
					Authorization: `Bearer ${accessToken}`,
				},
			})
			.catch((err: AxiosError<DiscordErrorData>) => {
				if (err.response?.status === 401) {
					// unauthorised, user probably revoked the token.
					revokeOAuthToken(accessToken, true);
				} else {
					console.error(
						`[Metadata] failed pushing discord metadata: [${err.code}] ${JSON.stringify(
							err.response?.data
						)}`
					);
				}
				return false;
			});

		this.ARCOCache[userId] = body;
		return true;
	}

	async discordIDfromSteam64(steam64: string) {
		const cached = this.UserCache.find(user => user.steamId == steam64)?.discordId;
		if (!cached) {
			const db = await this.sql.getLocalDatabase();
			const res = await db.get<LocalDatabaseEntry>(
				"SELECT * FROM discord_tokens where steam_id = ?;",
				steam64
			);
			if (res) {
				this.UserCache.push({ steamId: res.steam_id, discordId: res.user_id });
				return res.user_id;
			}
		}
		return cached;
	}

	async steam64fromDiscordID(discordId: string) {
		const cached = this.UserCache.find(user => user.steamId == discordId)?.steamId;
		if (cached) {
			const db = await this.sql.getLocalDatabase();
			const res = await db.get<LocalDatabaseEntry>(
				"SELECT * FROM discord_tokens where user_id = ?;",
				discordId
			);
			if (res) {
				this.UserCache.push({ steamId: res.steam_id, discordId: res.user_id });
				return res.steam_id;
			}
		}
		return cached;
	}
}

export default async (container: Container): Promise<Service> => {
	const metadata = new DiscordMetadata(container);
	return metadata;
};
