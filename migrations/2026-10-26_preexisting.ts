import { Kysely } from "kysely";

type UpgradeFunction = (db: Kysely<any>) => Promise<void>;
type NamedUpgradeFunction = [string, UpgradeFunction];
type NamedUpgradeFunctions = NamedUpgradeFunction[];

const preexistingTableDefinitions: Record<string, NamedUpgradeFunctions> = {
	oidc: [
		["oidc_tokens", async db => await db.schema
			.createTable("oidc_tokens")
			.ifNotExists()
			.addColumn("id", "text", col => col.primaryKey())
			.addColumn("grant_id", "text")
			.addColumn("payload", "text", col => col.notNull())
			.execute()],
		["oidc_uid_index", async db => await db.schema
			.createTable("oidc_uid_index")
			.ifNotExists()
			.addColumn("uid", "text", col => col.primaryKey())
			.addColumn("id", "text", col => col.notNull())
			.execute()],
	],
};

export async function up(db: Kysely<any>): Promise<void> {
	for (const definitions of Object.values(preexistingTableDefinitions)) {
		for (const [_tableName, upgrade] of definitions) {
			await upgrade(db);
		}
	}

}

export async function down(db: Kysely<any>): Promise<void> {
	for (const definitions of Object.values(preexistingTableDefinitions)) {
		for (const [tableName] of definitions) {
			await db.schema.dropTable(tableName).execute();
		}
	}
}
