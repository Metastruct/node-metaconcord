import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("discord_tokens").renameTo("xx-migration-discord_tokens-old").execute();
		await tx.schema
			.createTable("discord_tokens")
			.ifNotExists()
			.addColumn("user_id", "text", col => col.notNull().primaryKey())
			.addColumn("steam_id", "text")
			.addColumn("access_token", "text")
			.addColumn("refresh_token", "text")
			.addColumn("expires_at", "integer")
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("discord_tokens")
			.expression(eb => eb.selectFrom("xx-migration-discord_tokens-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-discord_tokens-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("discord_tokens").renameTo("xx-migration-discord_tokens-old").execute();
		await tx.schema
			.createTable("discord_tokens")
			.ifNotExists()
			.addColumn("user_id", "varchar(255)", col => col.primaryKey())
			.addColumn("steam_id", "varchar(255)")
			.addColumn("access_token", "varchar(255)")
			.addColumn("refresh_token", "varchar(255)")
			.addColumn("expires_at", "datetime")
			.execute();
		await tx.insertInto("discord_tokens")
			.expression(eb => eb.selectFrom("xx-migration-discord_tokens-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-discord_tokens-old").execute();
	},
});
