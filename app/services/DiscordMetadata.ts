import { Accounts, Bans, DiscordBot, SQL } from "./index.js";
import { Container, Service } from "../Container.js";
import { Role } from "./Accounts.js";
import { logger } from "@/utils.js";
import { revokeOAuthToken } from "./webapp/api/auth/discord.js";
import SteamID from "steamid";
import config from "@/config/metadata.json" with { type: "json" };

const log = logger(import.meta);

export type MetaMetadata = {
	banned?: 1 | 0;
	/** highest account role, see ROLE_LEVELS */
	dev?: number;
	coins?: number;
	time?: number; // playtime
};

/** administrator 3, developer 2, trial-developer 1, no role 0 */
export const ROLE_LEVELS: Record<Role, number> = {
	administrator: 3,
	developer: 2,
	"trial-developer": 1,
};

export const roleLevel = (roles: Role[]): number =>
	roles.reduce((level, role) => Math.max(level, ROLE_LEVELS[role] ?? 0), 0);

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

enum MetadataType {
	INTEGER_LESS_THAN_OR_EQUAL = 1,
	INTEGER_GREATER_THAN_OR_EQUAL = 2,
	INTEGER_EQUAL = 3,
	INTEGER_NOT_EQUAL = 4,
	DATETIME_LESS_THAN_OR_EQUAL = 5,
	DATETIME_GREATER_THAN_OR_EQUAL = 6,
	BOOLEAN_EQUAL = 7,
	BOOLEAN_NOT_EQUAL = 8,
}

type MetadataRecord = {
	type: MetadataType;
	key: keyof MetaMetadata;
	name: string;
	description: string;
};

/**
 * The keys Discord has to know before values are accepted. A linked role picks a key
 * and a value: "dev >= 1" trial developer, "dev >= 2" developer, "dev >= 3" administrator,
 * so an administrator holds all three.
 */
const METADATA_SCHEMA: MetadataRecord[] = [
	{
		type: MetadataType.BOOLEAN_EQUAL,
		key: "banned",
		name: "Banned",
		description: "Banned on the servers",
	},
	{
		type: MetadataType.INTEGER_GREATER_THAN_OR_EQUAL,
		key: "dev",
		name: "Role",
		description: "1 trial developer, 2 developer, 3 administrator",
	},
	{
		type: MetadataType.INTEGER_GREATER_THAN_OR_EQUAL,
		key: "coins",
		name: "Coins",
		description: "Coins on the servers",
	},
	{
		type: MetadataType.INTEGER_GREATER_THAN_OR_EQUAL,
		key: "time",
		name: "Playtime",
		description: "Hours played on the servers",
	},
];

type LocalDatabaseEntry = {
	user_id: string;
	access_token: string;
	refresh_token: string;
	expires_at: number;
};

type RevokeDBEntry = Pick<LocalDatabaseEntry, "user_id" | "access_token" | "refresh_token">;

export class DiscordMetadata extends Service {
	name = "DiscordMetadata";
	private ARCOCache: Record<string, ApplicationRoleConnectionObject> = {};
	private sql: SQL;
	private bot: DiscordBot;
	private bans: Bans;
	private accounts: Accounts;

	constructor(container: Container) {
		super(container);
	}

	async init() {
		this.sql = this.container.getService("SQL");
		this.bot = this.container.getService("DiscordBot");
		this.bans = this.container.getService("Bans");
		this.accounts = this.container.getService("Accounts");
		this.registerSchema().catch(err =>
			log.error(err, "linked roles metadata registration failed")
		);
	}

	/**
	 * Registers METADATA_SCHEMA with Discord when it differs from what is registered.
	 * A PUT replaces the whole schema, so records already there keep their name and
	 * description unless the key or type changed in code.
	 */
	private async registerSchema(): Promise<void> {
		const url = `https://discord.com/api/v10/applications/${this.bot.config.bot.applicationId}/role-connections/metadata`;
		const headers = { Authorization: `Bot ${this.bot.config.bot.token}` };
		const res = await fetch(url, { headers });
		if (!res.ok) {
			log.error({ status: res.status }, "could not read the linked roles metadata schema");
			return;
		}
		const current = (await res.json()) as MetadataRecord[];
		const same =
			current.length === METADATA_SCHEMA.length &&
			METADATA_SCHEMA.every(want =>
				current.some(c => c.key === want.key && c.type === want.type)
			);
		if (same) return;

		const put = await fetch(url, {
			method: "PUT",
			headers: { ...headers, "Content-Type": "application/json" },
			body: JSON.stringify(METADATA_SCHEMA),
		});
		if (!put.ok) {
			log.error(
				{ status: put.status, body: await put.text() },
				"linked roles metadata PUT failed"
			);
			return;
		}
		log.info(
			`linked roles metadata registered: ${METADATA_SCHEMA.map(m => m.key).join(", ")} (was ${current.map(c => c.key).join(", ") || "empty"})`
		);
	}

	private clearUserCaches(userId: string): void {
		delete this.ARCOCache[userId];
	}

	private async getAccessToken(userId: string, data: LocalDatabaseEntry) {
		if (Date.now() <= data.expires_at) return data.access_token;

		const res = await fetch("https://discord.com/api/v10/oauth2/token", {
			method: "POST",
			headers: {
				Authorization:
					"Basic " +
					Buffer.from(
						this.bot.config.bot.applicationId + ":" + this.bot.config.bot.clientSecret
					).toString("base64"),
			},
			body: new URLSearchParams({
				grant_type: "refresh_token",
				refresh_token: data.refresh_token,
			}),
		}).catch(err => {
			log.error(err, "network error fetching tokens");
		});
		if (!res) return;

		if (!res.ok) {
			const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
			if (body?.error === "invalid_grant") {
				await revokeOAuthToken(data.access_token);
				log.warn(body, `InValID_GraNT revoking token! ${userId}`);
				this.clearUserCaches(userId);
			} else {
				log.error(body, `failed fetching tokens: [${res.status}]`);
			}
			return;
		}

		const token: AccessTokenResponse = await res.json();
		const db = this.sql.getLocalDatabase();
		await db.run(
			"UPDATE discord_tokens SET access_token = ?, refresh_token = ?, expires_at = ? WHERE user_id = ?",
			[token.access_token, token.refresh_token, Date.now() + token.expires_in * 1000, userId]
		);
		return token.access_token;
	}

	async get(userId: string) {
		if (this.ARCOCache[userId]) return this.ARCOCache[userId];

		const url = `https://discord.com/api/v10/users/@me/applications/${this.bot.config.bot.applicationId}/role-connection`;
		const db = this.sql.getLocalDatabase();
		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens where user_id = ?;",
			userId
		);
		if (!data) return;
		const accessToken = await this.getAccessToken(userId, data);
		if (!accessToken) return;

		const res = await fetch(url, {
			headers: { Authorization: `Bearer ${accessToken}` },
		}).catch(err => {
			log.error(err, "network error fetching metadata");
		});
		if (!res?.ok) {
			delete this.ARCOCache[userId];
			return;
		}

		this.ARCOCache[userId] = (await res.json()) as ApplicationRoleConnectionObject;
		return this.ARCOCache[userId];
	}

	async update(userId: string) {
		const db = this.sql.getLocalDatabase();

		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens WHERE user_id = ?;",
			userId
		);
		if (!data) return false;

		// the linked role is about the game account, so it needs a Steam link
		const account = await this.accounts.findByLink("discord", userId);
		const steamId = account?.links.find(l => l.provider === "steam")?.providerId;
		if (!account || !steamId) return false;
		const accountId = new SteamID(steamId).accountid;

		const query1 = await this.sql.queryPool(`SELECT coins FROM coins WHERE accountid = $1;`, [
			accountId,
		]);
		const query2 = await this.sql.queryPool(
			"SELECT SUM(totaltime) from playingtime WHERE accountid = $1;",
			[accountId]
		);
		const query3 = await this.sql.queryPool(
			"SELECT value from kv WHERE key = $1 AND scope = 'meta_name'",
			[steamId]
		);
		const coins: number = query1[0]?.coins;
		const playtime: string = query2[0]?.sum;
		const bytea: Buffer = query3[0]?.value;
		let nick: string | undefined;

		if (query3[0]) {
			nick = bytea.toString("utf-8").replace(/<[^>]*>/g, "");
		} else {
			const steam = this.bot.container.getService("Steam");
			const summary = await steam.getUserSummaries(steamId);
			nick = summary?.personaname;
		}

		const discordUser = await this.bot.getGuildMember(userId);

		const banned =
			(await this.bans.getBan(steamId, true))?.b ||
			discordUser?.roles.cache.hasAny(...config.banned_roles);

		const metadata: MetaMetadata = {
			banned: banned ? 1 : 0,
			dev: roleLevel(account.roles),
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
			log.error({ userId, userName }, "accesstoken missing?");
			return false;
		}

		const res = await fetch(url, {
			method: "PUT",
			headers: {
				Authorization: `Bearer ${accessToken}`,
				"Content-Type": "application/json",
			},
			body: JSON.stringify(body),
		}).catch(err => {
			log.error(err, "network error pushing metadata");
		});

		if (!res) return false;

		if (res.status === 401) {
			log.info({ accessToken }, "unauthorized removing token");
			revokeOAuthToken(accessToken, true);
			this.clearUserCaches(userId);
			return false;
		}

		if (!res.ok) {
			log.error({ status: res.status }, "metadata push failed.");
			return false;
		}

		this.ARCOCache[userId] = body;
		return true;
	}

	private async revokeRoleConnection(userId: string): Promise<boolean> {
		const db = this.sql.getLocalDatabase();
		const data = await db.get<LocalDatabaseEntry>(
			"SELECT * FROM discord_tokens WHERE user_id = ?;",
			userId
		);
		if (!data) return false;

		const accessToken = await this.getAccessToken(userId, data);
		if (!accessToken) {
			log.warn({ userId }, "revoking role connection but no access token available");
			return false;
		}

		const url = `https://discord.com/api/v10/users/@me/applications/${this.bot.config.bot.applicationId}/role-connection`;
		const res = await fetch(url, {
			method: "DELETE",
			headers: { Authorization: `Bearer ${accessToken}` },
		}).catch(() => null);

		if (!res) return false;

		if (res.status === 401 || res.status === 404) {
			log.info({ userId }, "role connection already revoked");
			return false;
		}

		if (!res.ok) {
			log.error({ userId, status: res.status }, "role connection revoke failed");
			return false;
		}

		this.clearUserCaches(userId);
		return true;
	}

	async revoke(userId: string): Promise<boolean> {
		await this.revokeRoleConnection(userId).catch(() => {});

		const db = this.sql.getLocalDatabase();
		const data = await db.get<RevokeDBEntry>(
			"SELECT user_id, access_token, refresh_token FROM discord_tokens WHERE user_id = ?;",
			userId
		);
		if (!data) {
			this.clearUserCaches(userId);
			return false;
		}

		const basicAuthStr =
			"Basic " +
			Buffer.from(
				this.bot.config.bot.applicationId + ":" + this.bot.config.bot.clientSecret
			).toString("base64");

		await fetch("https://discord.com/api/v10/oauth2/token/revoke", {
			method: "POST",
			headers: { Authorization: basicAuthStr },
			body: new URLSearchParams({
				token: data.access_token,
				token_type_hint: "access_token",
			}),
		}).catch(() => {});

		await db.run("DELETE FROM discord_tokens WHERE user_id = ?", userId);
		this.clearUserCaches(userId);
		return true;
	}

	/** Imported links count here: this is about game data, not website roles. */
	async discordIDfromSteam64(steam64: string): Promise<string | undefined> {
		const account = await this.accounts.findByLink("steam", steam64);
		return account?.links.find(l => l.provider === "discord")?.providerId;
	}

	async steam64fromDiscordID(discordId: string): Promise<string | undefined> {
		const account = await this.accounts.findByLink("discord", discordId);
		return account?.links.find(l => l.provider === "steam")?.providerId;
	}
}

export default (container: Container): Service => {
	return new DiscordMetadata(container);
};
