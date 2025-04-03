import { EphemeralResponse } from "..";
import { MenuCommand, SlashCommand } from "@/extensions/discord";
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
				await ctx.deferReply({ flags: Discord.MessageFlags.Ephemeral });
				const db = await (await bot.container.getService("SQL")).getLocalDatabase();
				if (!db) {
					ctx.followUp(EphemeralResponse("Could not get the DB :("));
					return;
				}
				const result = await db.run("DELETE FROM media_urls WHERE url = ?", url);
				await ctx.followUp(
					EphemeralResponse(
						result?.changes !== undefined && result?.changes > 0 // wtf can this not be a oneliner without checking for undefined explicitly somehow?
							? "👍"
							: "👎 (probably doesn't exist or is pulled from tenor)"
					)
				);
				break;
			default:
				break;
		}
	},
};

export const SlashForceMotd: SlashCommand = {
	options: {
		name: "force_motd",
		description: "forces the bot to send the motd",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
	},
	execute: async (ctx, bot) => {
		const msg = await (await bot.container.getService("Motd")).executeMessageJob();
		if (msg) {
			await ctx.reply(EphemeralResponse("👍"));
		}
		await ctx.reply(EphemeralResponse("👎"));
	},
};

export const MenuManageMediaLinksCommand: MenuCommand = {
	options: {
		name: "remove media from bot cache",
		type: Discord.ApplicationCommandType.Message,
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot) => {
		const msg = ctx.targetMessage;
		const text = msg.content;

		if (msg.author.id !== ctx.client.user.id) {
			await ctx.reply(
				EphemeralResponse(`can only be used on messages sent by ${ctx.client.user.mention}`)
			);
			return;
		}

		if (!text.startsWith("http")) {
			await ctx.reply(EphemeralResponse("this doesn't look like a media link"));
			return;
		}
		await ctx.deferReply({ flags: Discord.MessageFlags.Ephemeral });
		const db = await (await bot.container.getService("SQL")).getLocalDatabase();
		if (!db) {
			ctx.followUp(EphemeralResponse("Could not get the DB :("));
			return;
		}
		const result = await db.run("DELETE FROM media_urls WHERE url = ?", text);
		await msg.delete();
		await ctx.followUp(
			EphemeralResponse(
				result?.changes !== undefined && result?.changes > 0
					? "👍"
					: "👎 (probably doesn't exist or is pulled from tenor)"
			)
		);
	},
};
