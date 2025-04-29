import * as Discord from "discord.js";
import { DiscordBot } from "@/app/services/index.js";
import { EphemeralResponse, MenuCommand } from "@/extensions/discord.js";

export const MenuWhyRoleCommand: MenuCommand = {
	options: {
		name: "Perma-Role reason",
		type: Discord.ApplicationCommandType.User,
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot: DiscordBot) => {
		const dataService = await bot.container.getService("Data");
		const { permaRoles } = dataService;
		const userId = ctx.targetId;
		if (!userId) {
			ctx.reply(EphemeralResponse("TargetId missing :( (blame me or discord)"));
			return;
		}

		if (permaRoles && permaRoles[userId]) {
			const roles = permaRoles[userId].roles;
			const guild = bot.getGuild();
			if (guild) {
				let content = "";
				for (const [roleId, data] of Object.entries(roles)) {
					content =
						content +
						`<@&${roleId}> added by <@${data.adderId}> <t:${data.timeStamp
							.toString()
							.substring(0, 10)}:R>${Object.entries(roles).length > 1 ? "\n" : ""}`;
				}
				await ctx.reply(EphemeralResponse(content));
			} else {
				await ctx.reply(EphemeralResponse("wtf"));
			}
		} else {
			await ctx.reply(
				EphemeralResponse(
					userId == ctx.user.id
						? "You're don't have any perma roles... yet!"
						: "That user doesn't have perma roles... yet!"
				)
			);
		}
	},
};
