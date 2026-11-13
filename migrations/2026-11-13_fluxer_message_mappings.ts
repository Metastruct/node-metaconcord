import { sql } from "kysely";

import { defineSQLiteMigration, NOW_MS } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		// Rename `created_at_ms` to `updated_at_ms`, add NOT NULL but with a non-constant default.
		// This requires rebuilding the table, as `ALTER TABLE ADD COLUMN` doesn't like this for some reason.
		// "The column may not have a default value of CURRENT_TIME, CURRENT_DATE, CURRENT_TIMESTAMP, or an expression in parentheses."
		await tx.schema.alterTable("fluxer_message_mappings").renameTo("xx-migration-fluxer_message_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_message_mappings")
			.addColumn("discord_message_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_message_id", "text", col => col.notNull().unique())
			.addColumn("discord_channel_id", "text", col => col.notNull())
			.addColumn("fluxer_channel_id", "text", col => col.notNull())
			.addColumn("origin", "text", col => col.notNull().check(sql`origin IN ('discord', 'fluxer')`))
			.addColumn("updated_at_ms", "integer", col => col.notNull().defaultTo(NOW_MS))
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_message_mappings")
			.columns([
				"discord_message_id",
				"fluxer_message_id",
				"discord_channel_id",
				"fluxer_channel_id",
				"origin",
				"updated_at_ms",
			])
			.expression(eb => eb.selectFrom("xx-migration-fluxer_message_mappings-old").select([
				"discord_message_id",
				"fluxer_message_id",
				"discord_channel_id",
				"fluxer_channel_id",
				"origin",
				"created_at_ms as updated_at_ms",
			]))
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_message_mappings-old").execute();

		// This set of unique channel IDs is synced from the config (source-of-truth) by the application.
		await tx.schema
			.createTable("fluxer_message_mappings_permanent_channels")
			.addColumn("channel_id", "text", col => col.notNull().primaryKey())
			.modifyEnd(sql`STRICT`)
			.execute();

		// This removes expired messages from non-permanent channels.
		// Expiry is defined as "older than 10 days".
		// Permanent channels are defined in the table above.
		await sql`
			CREATE TRIGGER fluxer_message_mappings_trim_after_insert
			AFTER INSERT ON fluxer_message_mappings
			BEGIN
			  DELETE FROM fluxer_message_mappings
			  WHERE updated_at_ms < unixepoch('now', '-10 days') * 1000
			    AND discord_channel_id NOT IN (
					SELECT channel_id
					FROM fluxer_message_mappings_permanent_channels
				);
			END;
		`.execute(tx);
	},

	async down(tx) {
		await sql`DROP TRIGGER fluxer_message_mappings_trim_after_insert;`.execute(tx);
		await tx.schema.dropTable("fluxer_message_mappings_permanent_channels")
			.execute();

		await tx.schema.alterTable("fluxer_message_mappings").renameTo("xx-migration-fluxer_message_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_message_mappings")
			.addColumn("discord_message_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_message_id", "text", col => col.notNull().unique())
			.addColumn("discord_channel_id", "text", col => col.notNull())
			.addColumn("fluxer_channel_id", "text", col => col.notNull())
			.addColumn("origin", "text", col => col.notNull().check(sql`origin IN ('discord', 'fluxer')`))
			.addColumn("created_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_message_mappings")
			.columns([
				"discord_message_id",
				"fluxer_message_id",
				"discord_channel_id",
				"fluxer_channel_id",
				"origin",
				"created_at_ms",
			])
			.expression(eb => eb.selectFrom("xx-migration-fluxer_message_mappings-old")
				.select([
					"discord_message_id",
					"fluxer_message_id",
					"discord_channel_id",
					"fluxer_channel_id",
					"origin",
					"updated_at_ms as created_at_ms",
				]))
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_message_mappings-old").execute();
	},
});
