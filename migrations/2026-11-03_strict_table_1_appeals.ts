import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("appeals").renameTo("xx-migration-appeals-old").execute();
		await tx.schema
			.createTable("appeals")
			.ifNotExists()
			.addColumn("id", "integer", col => col.notNull().primaryKey().autoIncrement())
			.addColumn("steam_id64", "text", col => col.notNull())
			.addColumn("banned_at", "integer", col => col.notNull())
			.addColumn("thread_id", "text", col => col.notNull())
			.addColumn("message_id", "text", col => col.notNull())
			.addColumn("created_at", "integer", col => col.notNull())
			.addColumn("closed_at", "integer")
			.addColumn("resolution", "text")
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("appeals")
			.expression(eb => eb.selectFrom("xx-migration-appeals-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-appeals-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("appeals").renameTo("xx-migration-appeals-old").execute();
		await tx.schema
			.createTable("appeals")
			.ifNotExists()
			.addColumn("id", "integer", col => col.primaryKey().autoIncrement())
			.addColumn("steam_id64", "text", col => col.notNull())
			.addColumn("banned_at", "integer", col => col.notNull())
			.addColumn("thread_id", "text", col => col.notNull())
			.addColumn("message_id", "text", col => col.notNull())
			.addColumn("created_at", "integer", col => col.notNull())
			.addColumn("closed_at", "integer")
			.addColumn("resolution", "text")
			.execute();
		await tx.schema
			.createIndex("appeals_steam")
			.ifNotExists()
			.on("appeals")
			.column("steam_id64")
			.execute();
		await tx.schema
			.createIndex("appeals_open")
			.ifNotExists()
			.unique()
			.on("appeals")
			.columns(["steam_id64", "banned_at"])
			.where(sql.ref("closed_at"), "is", null)
			.execute();
		await tx.insertInto("appeals")
			.expression(eb => eb.selectFrom("xx-migration-appeals-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-appeals-old").execute();
	},
});
