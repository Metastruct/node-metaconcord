import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.createTable("webhook_commit_messages")
			.addColumn("commit_key", "text", col => col.primaryKey().notNull())
			.addColumn("message_id", "text", col => col.notNull())
			.addColumn("components_json", "text", col => col.notNull())
			.addColumn("container_index", "integer", col => col.notNull().check(sql`container_index >= 0`))
			.addColumn("checks_display_index", "integer", col => col.check(sql`checks_display_index IS NULL OR checks_display_index >= 0`))
			.addColumn("checks_json", "text", col => col.notNull())
			.addColumn("updated_at", "integer", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();

		await sql`
			CREATE TRIGGER webhook_commit_messages_trim_after_insert
			AFTER INSERT ON webhook_commit_messages
			BEGIN
			  DELETE FROM webhook_commit_messages
			  WHERE updated_at < unixepoch('now', '-3 days') * 1000;
			END;
		`.execute(tx);
	},

	async down(tx) {
		await sql`DROP TRIGGER webhook_commit_messages_trim_after_insert;`.execute(tx);
		await tx.schema.dropTable("webhook_commit_messages").execute();
	},
});
