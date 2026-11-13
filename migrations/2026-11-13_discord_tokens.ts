import { defineSQLiteMigration } from "#lib/kyselyDefineSQLiteMigration";

export const { up, down } = defineSQLiteMigration({
	async up(tx) {
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("access_token", acb => acb.setNotNull())
			.execute();
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("refresh_token", acb => acb.setNotNull())
			.execute();
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("expires_at", acb => acb.setNotNull())
			.execute();
	},

	async down(tx) {
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("access_token", acb => acb.dropNotNull())
			.execute();
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("refresh_token", acb => acb.dropNotNull())
			.execute();
		await tx.schema.alterTable("discord_tokens")
			.alterColumn("expires_at", acb => acb.dropNotNull())
			.execute();
	},
});
