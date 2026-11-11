import { sql } from "kysely";

import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

// A declared INTEGER PRIMARY KEY keeps external-content IDs stable across VACUUM.
// Explicit-ID REPLACE writes require recursive_triggers so deletes reach FTS.
export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("markov").renameTo("xx-migration-markov-old").execute();
		await tx.schema
			.createTable("markov")
			.addColumn("id", "integer", col => col.notNull().primaryKey())
			.addColumn("message", "text", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await sql`INSERT INTO markov(id, message)
			SELECT rowid, message FROM "xx-migration-markov-old"`.execute(tx);
		await tx.schema.dropTable("xx-migration-markov-old").execute();

		await sql`CREATE VIRTUAL TABLE markov_ft USING fts5(
			message,
			content='markov',
			content_rowid='id',
			tokenize='unicode61 remove_diacritics 0',
			detail=full,
			columnsize=0
		)`.execute(tx);
		await sql`CREATE TRIGGER markov_ft_insert AFTER INSERT ON markov BEGIN
			INSERT INTO markov_ft(rowid, message) VALUES (new.id, new.message);
		END`.execute(tx);
		await sql`CREATE TRIGGER markov_ft_delete AFTER DELETE ON markov BEGIN
			INSERT INTO markov_ft(markov_ft, rowid, message) VALUES ('delete', old.id, old.message);
		END`.execute(tx);
		// All updates, including changes to id (or its rowid alias), update FTS.
		await sql`CREATE TRIGGER markov_ft_update AFTER UPDATE ON markov BEGIN
			INSERT INTO markov_ft(markov_ft, rowid, message) VALUES ('delete', old.id, old.message);
			INSERT INTO markov_ft(rowid, message) VALUES (new.id, new.message);
		END`.execute(tx);

		await tx.insertInto("markov_ft").values({ markov_ft: "rebuild" }).execute();
	},

	async down(tx) {
		await sql`DROP TRIGGER markov_ft_insert`.execute(tx);
		await sql`DROP TRIGGER markov_ft_delete`.execute(tx);
		await sql`DROP TRIGGER markov_ft_update`.execute(tx);

		await tx.schema.dropTable("markov_ft").execute();

		await tx.schema.alterTable("markov").renameTo("xx-migration-markov-old").execute();
		await tx.schema
			.createTable("markov")
			.addColumn("message", "text", col => col.notNull())
			.modifyEnd(sql`STRICT`)
			.execute();
		await sql`INSERT INTO markov(rowid, message)
			SELECT id, message FROM "xx-migration-markov-old"`.execute(tx);
		await tx.schema.dropTable("xx-migration-markov-old").execute();
	},
});
