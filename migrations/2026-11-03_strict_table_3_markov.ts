import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("markov").renameTo("xx-migration-markov-old").execute();
		await tx.schema
			.createTable("markov")
			.ifNotExists()
			.addColumn("message", "text", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("markov")
			.expression(eb => eb.selectFrom("xx-migration-markov-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-markov-old").execute();
	},

	async down(tx) {
		await tx.schema.alterTable("markov").renameTo("xx-migration-markov-old").execute();
		await tx.schema
			.createTable("markov")
			.ifNotExists()
			.addColumn("message", "varchar(255)")
			.execute();
		await tx.insertInto("markov")
			.expression(eb => eb.selectFrom("xx-migration-markov-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-markov-old").execute();
	},
});
