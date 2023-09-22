import { EphemeralResponse } from "..";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const SlashManageMediaLinks: SlashCommand = {
	options: {
		name: "media_link",
		description: "Manages links from the bot replies.",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "remove",
				description: "removes a link from the database",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "url",
						description: "the url you want to remove",
						required: true,
					},
				],
			},
		],
	},
	execute: async (ctx, bot) => {
		const cmd = ctx.options.getSubcommand();
		switch (cmd) {
			case "remove":
				const url = ctx.options.getString("url", true);
				await ctx.deferReply({ ephemeral: true });
				const db = await bot.container.getService("SQL")?.getLocalDatabase();
				if (!db) {
					ctx.followUp(EphemeralResponse("Could not get the DB :("));
					return;
				}
				const success = new Promise<boolean>((resolve, reject) => {
					db.run("DELETE FROM media_urls WHERE url = ?", url, [], (err: Error | null) => {
						if (err) {
							reject(false);
						} else {
							resolve(true);
						}
					});
				});
				await ctx.followUp(
					EphemeralResponse((await success) ? "👍" : "👎(probably doesn't exist)")
				);
				break;
			default:
				break;
		}
	},
};
