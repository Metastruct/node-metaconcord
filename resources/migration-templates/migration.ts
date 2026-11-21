import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.createTable("hello")
			.addColumn("id", "integer", col => col.notNull().primaryKey())
			.execute();
	},

	async down(tx) {
		await tx.schema.dropTable("hello")
			.execute();
	},
});
