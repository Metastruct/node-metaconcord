import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("starboard").renameTo("xx-migration-starboard-old").execute();
		await tx.schema
			.createTable("starboard")
			.addColumn("message_id", "text", col => col.notNull().primaryKey())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("starboard")
			.columns(["message_id"])
			.expression(eb => eb.selectFrom("xx-migration-starboard-old").select("MessageId").distinct())
			.execute();
		await tx.schema.dropTable("xx-migration-starboard-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("starboard").renameTo("xx-migration-starboard-old").execute();
		await tx.schema
			.createTable("starboard")
			.addColumn("MessageId", "varchar(1000)")
			.execute();
		await tx.insertInto("starboard")
			.columns(["MessageId"])
			.expression(eb => eb.selectFrom("xx-migration-starboard-old").select("message_id"))
			.execute();
		await tx.schema.dropTable("xx-migration-starboard-old").execute();
	},
});
