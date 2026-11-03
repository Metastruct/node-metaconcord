import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("media_urls").renameTo("xx-migration-media_urls-old").execute();
		await tx.schema
			.createTable("media_urls")
			.ifNotExists()
			.addColumn("url", "text", col => col.notNull().primaryKey())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("media_urls")
			.expression(eb => eb.selectFrom("xx-migration-media_urls-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-media_urls-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("media_urls").renameTo("xx-migration-media_urls-old").execute();
		await tx.schema
			.createTable("media_urls")
			.ifNotExists()
			.addColumn("url", "varchar(255)", col => col.notNull().unique())
			.execute();
		await tx.insertInto("media_urls")
			.expression(eb => eb.selectFrom("xx-migration-media_urls-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-media_urls-old").execute();
	},
});
