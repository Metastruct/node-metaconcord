import { type Kysely, sql } from "kysely";

// Channel and role routes now come straight from app/services/fluxer/mappings.json;
// only runtime-created thread links still live in the database.
export async function up(db: Kysely<any>): Promise<void> {
	await db.schema.dropTable("fluxer_channel_mappings").ifExists().execute();
	await db.schema.dropTable("fluxer_role_mappings").ifExists().execute();
}

export async function down(db: Kysely<any>): Promise<void> {
	await db.schema
		.createTable("fluxer_channel_mappings")
		.ifNotExists()
		.addColumn("discord_channel_id", "text", col => col.primaryKey())
		.addColumn("fluxer_channel_id", "text", col => col.notNull().unique())
		.addColumn("discord_parent_id", "text")
		.addColumn("channel_kind", "text", col => col.notNull())
		.addColumn("relay_enabled", "integer", col => col.notNull().defaultTo(0).check(sql`relay_enabled IN (0, 1)`))
		.addColumn("updated_at_ms", "integer", col => col.notNull())
		.execute();
	await db.schema
		.createTable("fluxer_role_mappings")
		.ifNotExists()
		.addColumn("discord_role_id", "text", col => col.primaryKey())
		.addColumn("fluxer_role_id", "text", col => col.notNull().unique())
		.addColumn("updated_at_ms", "integer", col => col.notNull())
		.execute();
}
