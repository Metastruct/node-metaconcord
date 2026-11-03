import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("oidc_tokens").renameTo("xx-migration-oidc_tokens-old").execute();
		await tx.schema
			.createTable("oidc_tokens")
			.ifNotExists()
			.addColumn("id", "text", col => col.notNull().primaryKey())
			.addColumn("grant_id", "text")
			.addColumn("payload", "text", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("oidc_tokens")
			.expression(eb => eb.selectFrom("xx-migration-oidc_tokens-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-oidc_tokens-old").execute();

		// Warning: deleting orphan data from oidc_uid_index where no matching rows exist in oidc_tokens.
		// This cannot be undone.
		await tx.deleteFrom("oidc_uid_index")
			.where("id", "not in", eb => eb.selectFrom("oidc_tokens").select("id"))
			.execute();

		await tx.schema.alterTable("oidc_uid_index").renameTo("xx-migration-oidc_uid_index-old").execute();
		await tx.schema
			.createTable("oidc_uid_index")
			.ifNotExists()
			.addColumn("uid", "text", col => col.notNull().primaryKey())
			.addColumn("id", "text", col => col.notNull().unique().references("oidc_tokens.id").onDelete("cascade").onUpdate("no action"))
			.modifyEnd(sql`STRICT`)
			.execute();
		await tx.insertInto("oidc_uid_index")
			.expression(eb => eb.selectFrom("xx-migration-oidc_uid_index-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-oidc_uid_index-old").execute();
	},

	async down(tx) {
		// Downgrade oidc_uid_index first (to a non-fk table) to avoid cascading deletes and losing data.
		await tx.schema.alterTable("oidc_uid_index").renameTo("xx-migration-oidc_uid_index-old").execute();
		await tx.schema
			.createTable("oidc_uid_index")
			.ifNotExists()
			.addColumn("uid", "text", col => col.primaryKey())
			.addColumn("id", "text", col => col.notNull())
			.execute();
		await tx.insertInto("oidc_uid_index")
			.expression(eb => eb.selectFrom("xx-migration-oidc_uid_index-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-oidc_uid_index-old").execute();

		await tx.schema.alterTable("oidc_tokens").renameTo("xx-migration-oidc_tokens-old").execute();
		await tx.schema
			.createTable("oidc_tokens")
			.ifNotExists()
			.addColumn("id", "text", col => col.primaryKey())
			.addColumn("grant_id", "text")
			.addColumn("payload", "text", col => col.notNull())
			.execute();
		await tx.insertInto("oidc_tokens")
			.expression(eb => eb.selectFrom("xx-migration-oidc_tokens-old").selectAll())
			.execute();
		await tx.schema.dropTable("xx-migration-oidc_tokens-old").execute();
	},
});
