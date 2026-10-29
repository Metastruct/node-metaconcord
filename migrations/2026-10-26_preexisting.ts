import { Kysely, sql } from "kysely";

/* eslint arrow-body-style: ["error", "always"] */

type UpgradeFunction = (db: Kysely<any>) => Promise<void>;
type NamedUpgradeFunction = [string, UpgradeFunction];
type NamedUpgradeFunctions = NamedUpgradeFunction[];

const preexistingTableDefinitions: Record<string, NamedUpgradeFunctions> = {
	starboard: [
		["starboard", async db => {
			await db.schema
				.createTable("starboard")
				.ifNotExists()
				.addColumn("MessageId", "integer", col => {return col.primaryKey();})
				.execute();
		}],
	],
	markov: [
		["markov", async db => {
			await db.schema
				.createTable("markov")
				.ifNotExists()
				.addColumn("message", "varchar(255)")
				.execute();
		}],
	],
	shitposting: [
		["media_urls", async db => {
			await db.schema
				.createTable("media_urls")
				.ifNotExists()
				.addColumn("url", "varchar(255)", col => {return col.notNull().unique();})
				.execute();
		}],
	],
	appeals: [
		["appeals", async db => {
			await db.schema
				.createTable("appeals")
				.ifNotExists()
				.addColumn("id", "integer", col => {return col.primaryKey().autoIncrement();})
				.addColumn("steam_id64", "text", col => {return col.notNull();})
				.addColumn("banned_at", "integer", col => {return col.notNull();})
				.addColumn("thread_id", "text", col => {return col.notNull();})
				.addColumn("message_id", "text", col => {return col.notNull();})
				.addColumn("created_at", "integer", col => {return col.notNull();})
				.addColumn("closed_at", "integer")
				.addColumn("resolution", "text")
				.execute();
			await db.schema
				.createIndex("appeals_steam")
				.ifNotExists()
				.on("appeals")
				.column("steam_id64")
				.execute();
			await db.schema
				.createIndex("appeals_open")
				.ifNotExists()
				.unique()
				.on("appeals")
				.columns(["steam_id64", "banned_at"])
				.where(sql.ref("closed_at"), "is", null)
				.execute();
		}],
	],
	discordAuth: [
		["discord_tokens", async db => {
			await db.schema
				.createTable("discord_tokens")
				.ifNotExists()
				.addColumn("user_id", "varchar(255)", col => {return col.primaryKey();})
				.addColumn("steam_id", "varchar(255)")
				.addColumn("access_token", "varchar(255)")
				.addColumn("refresh_token", "varchar(255)")
				.addColumn("expires_at", "datetime")
				.execute();
		}],
	],
	fluxer: [
		["fluxer_channel_mappings", async db => {
			await db.schema
				.createTable("fluxer_channel_mappings")
				.ifNotExists()
				.addColumn("discord_channel_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_channel_id", "text", col => {return col.notNull().unique();})
				.addColumn("discord_parent_id", "text")
				.addColumn("channel_kind", "text", col => {return col.notNull();})
				.addColumn("relay_enabled", "integer", col => {return col.notNull().defaultTo(0).check(sql`relay_enabled IN (0, 1)`);})
				.addColumn("updated_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_role_mappings", async db => {
			await db.schema
				.createTable("fluxer_role_mappings")
				.ifNotExists()
				.addColumn("discord_role_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_role_id", "text", col => {return col.notNull().unique();})
				.addColumn("updated_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_message_mappings", async db => {
			await db.schema
				.createTable("fluxer_message_mappings")
				.ifNotExists()
				.addColumn("discord_message_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_message_id", "text", col => {return col.notNull().unique();})
				.addColumn("discord_channel_id", "text", col => {return col.notNull();})
				.addColumn("fluxer_channel_id", "text", col => {return col.notNull();})
				.addColumn("origin", "text", col => {return col.notNull().check(sql`origin IN ('discord', 'fluxer')`);})
				.addColumn("created_at_ms", "integer", col => {return col.notNull();})
				.execute();
			await db.schema
				.createIndex("fluxer_message_mappings_created")
				.ifNotExists()
				.on("fluxer_message_mappings")
				.column("created_at_ms")
				.execute();
		}],
		["fluxer_user_links", async db => {
			await db.schema
				.createTable("fluxer_user_links")
				.ifNotExists()
				.addColumn("discord_user_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_user_id", "text", col => {return col.notNull().unique();})
				.addColumn("created_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_link_codes", async db => {
			await db.schema
				.createTable("fluxer_link_codes")
				.ifNotExists()
				.addColumn("code", "text", col => {return col.primaryKey();})
				.addColumn("discord_user_id", "text", col => {return col.notNull().unique();})
				.addColumn("expires_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_emoji_mappings", async db => {
			await db.schema
				.createTable("fluxer_emoji_mappings")
				.ifNotExists()
				.addColumn("discord_emoji_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_emoji_id", "text", col => {return col.notNull().unique();})
				.addColumn("name", "text", col => {return col.notNull();})
				.addColumn("animated", "integer", col => {return col.notNull().check(sql`animated IN (0, 1)`);})
				.addColumn("updated_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_sticker_mappings", async db => {
			await db.schema
				.createTable("fluxer_sticker_mappings")
				.ifNotExists()
				.addColumn("discord_sticker_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_sticker_id", "text", col => {return col.notNull().unique();})
				.addColumn("name", "text", col => {return col.notNull();})
				.addColumn("updated_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
		["fluxer_thread_links", async db => {
			await db.schema
				.createTable("fluxer_thread_links")
				.ifNotExists()
				.addColumn("discord_thread_id", "text", col => {return col.primaryKey();})
				.addColumn("fluxer_thread_id", "text", col => {return col.notNull().unique();})
				.addColumn("discord_parent_id", "text", col => {return col.notNull();})
				.addColumn("fluxer_parent_id", "text", col => {return col.notNull();})
				.addColumn("channel_kind", "text", col => {return col.notNull();})
				.addColumn("relay_enabled", "integer", col => {return col.notNull().defaultTo(1).check(sql`relay_enabled IN (0, 1)`);})
				.addColumn("updated_at_ms", "integer", col => {return col.notNull();})
				.execute();
		}],
	],
	oidc: [
		["oidc_tokens", async db => {
			await db.schema
				.createTable("oidc_tokens")
				.ifNotExists()
				.addColumn("id", "text", col => {return col.primaryKey();})
				.addColumn("grant_id", "text")
				.addColumn("payload", "text", col => {return col.notNull();})
				.execute();
		}],
		["oidc_uid_index", async db => {
			await db.schema
				.createTable("oidc_uid_index")
				.ifNotExists()
				.addColumn("uid", "text", col => {return col.primaryKey();})
				.addColumn("id", "text", col => {return col.notNull();})
				.execute();
		}],
	],
};

export async function up(db: Kysely<any>): Promise<void> {
	for (const definitions of Object.values(preexistingTableDefinitions)) {
		for (const [_tableName, upgrade] of definitions) {
			await upgrade(db);
		}
	}

}

export async function down(db: Kysely<any>): Promise<void> {
	for (const definitions of Object.values(preexistingTableDefinitions)) {
		for (const [tableName] of definitions) {
			await db.schema.dropTable(tableName).execute();
		}
	}
}
