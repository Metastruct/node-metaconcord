import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
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
			.expression(eb => eb.selectFrom("xx-migration-fluxer_message_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_message_mappings-old").execute();

		await tx.schema.alterTable("fluxer_user_links").renameTo("xx-migration-fluxer_user_links-old").execute();
		await tx.schema
			.createTable("fluxer_user_links")
			.addColumn("discord_user_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_user_id", "text", col => col.notNull().unique())
			.addColumn("created_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_user_links")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_user_links-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_user_links-old").execute();

		await tx.schema.alterTable("fluxer_link_codes").renameTo("xx-migration-fluxer_link_codes-old").execute();
		await tx.schema
			.createTable("fluxer_link_codes")
			.addColumn("code", "text", col => col.notNull().primaryKey())
			.addColumn("discord_user_id", "text", col => col.notNull().unique())
			.addColumn("expires_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_link_codes")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_link_codes-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_link_codes-old").execute();

		await tx.schema.alterTable("fluxer_emoji_mappings").renameTo("xx-migration-fluxer_emoji_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_emoji_mappings")
			.addColumn("discord_emoji_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_emoji_id", "text", col => col.notNull().unique())
			.addColumn("name", "text", col => col.notNull())
			.addColumn("animated", "integer", col => col.notNull().check(sql`animated IN (0, 1)`))
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_emoji_mappings")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_emoji_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_emoji_mappings-old").execute();

		await tx.schema.alterTable("fluxer_sticker_mappings").renameTo("xx-migration-fluxer_sticker_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_sticker_mappings")
			.addColumn("discord_sticker_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_sticker_id", "text", col => col.notNull().unique())
			.addColumn("name", "text", col => col.notNull())
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_sticker_mappings")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_sticker_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_sticker_mappings-old").execute();

		await tx.schema.alterTable("fluxer_thread_links").renameTo("xx-migration-fluxer_thread_links-old").execute();
		await tx.schema
			.createTable("fluxer_thread_links")
			.addColumn("discord_thread_id", "text", col => col.notNull().primaryKey())
			.addColumn("fluxer_thread_id", "text", col => col.notNull().unique())
			.addColumn("discord_parent_id", "text", col => col.notNull())
			.addColumn("fluxer_parent_id", "text", col => col.notNull())
			.addColumn("channel_kind", "text", col => col.notNull())
			.addColumn("relay_enabled", "integer", col => col.notNull().defaultTo(1).check(sql`relay_enabled IN (0, 1)`))
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("fluxer_thread_links")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_thread_links-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_thread_links-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("fluxer_message_mappings").renameTo("xx-migration-fluxer_message_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_message_mappings")
			.addColumn("discord_message_id", "text", col => col.primaryKey())
			.addColumn("fluxer_message_id", "text", col => col.notNull().unique())
			.addColumn("discord_channel_id", "text", col => col.notNull())
			.addColumn("fluxer_channel_id", "text", col => col.notNull())
			.addColumn("origin", "text", col => col.notNull().check(sql`origin IN ('discord', 'fluxer')`))
			.addColumn("created_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_message_mappings")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_message_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_message_mappings-old").execute();
		await tx.schema
			.createIndex("fluxer_message_mappings_created")
			.on("fluxer_message_mappings")
			.column("created_at_ms")
			.execute();

		await tx.schema.alterTable("fluxer_user_links").renameTo("xx-migration-fluxer_user_links-old").execute();
		await tx.schema
			.createTable("fluxer_user_links")
			.addColumn("discord_user_id", "text", col => col.primaryKey())
			.addColumn("fluxer_user_id", "text", col => col.notNull().unique())
			.addColumn("created_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_user_links")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_user_links-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_user_links-old").execute();

		await tx.schema.alterTable("fluxer_link_codes").renameTo("xx-migration-fluxer_link_codes-old").execute();
		await tx.schema
			.createTable("fluxer_link_codes")
			.addColumn("code", "text", col => col.primaryKey())
			.addColumn("discord_user_id", "text", col => col.notNull().unique())
			.addColumn("expires_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_link_codes")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_link_codes-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_link_codes-old").execute();

		await tx.schema.alterTable("fluxer_emoji_mappings").renameTo("xx-migration-fluxer_emoji_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_emoji_mappings")
			.addColumn("discord_emoji_id", "text", col => col.primaryKey())
			.addColumn("fluxer_emoji_id", "text", col => col.notNull().unique())
			.addColumn("name", "text", col => col.notNull())
			.addColumn("animated", "integer", col => col.notNull().check(sql`animated IN (0, 1)`))
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_emoji_mappings")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_emoji_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_emoji_mappings-old").execute();

		await tx.schema.alterTable("fluxer_sticker_mappings").renameTo("xx-migration-fluxer_sticker_mappings-old").execute();
		await tx.schema
			.createTable("fluxer_sticker_mappings")
			.addColumn("discord_sticker_id", "text", col => col.primaryKey())
			.addColumn("fluxer_sticker_id", "text", col => col.notNull().unique())
			.addColumn("name", "text", col => col.notNull())
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_sticker_mappings")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_sticker_mappings-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_sticker_mappings-old").execute();

		await tx.schema.alterTable("fluxer_thread_links").renameTo("xx-migration-fluxer_thread_links-old").execute();
		await tx.schema
			.createTable("fluxer_thread_links")
			.addColumn("discord_thread_id", "text", col => col.primaryKey())
			.addColumn("fluxer_thread_id", "text", col => col.notNull().unique())
			.addColumn("discord_parent_id", "text", col => col.notNull())
			.addColumn("fluxer_parent_id", "text", col => col.notNull())
			.addColumn("channel_kind", "text", col => col.notNull())
			.addColumn("relay_enabled", "integer", col => col.notNull().defaultTo(1).check(sql`relay_enabled IN (0, 1)`))
			.addColumn("updated_at_ms", "integer", col => col.notNull())
			.execute();
		await tx.insertInto("fluxer_thread_links")
			.expression(eb => eb.selectFrom("xx-migration-fluxer_thread_links-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-fluxer_thread_links-old").execute();
	},
});
