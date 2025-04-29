import * as Discord from "discord.js";
import { EphemeralResponse, MenuCommand } from "@/extensions/discord.js";
import discordConfig from "@/config/discord.json" with { type: "json" };

export const MenuRemoveHighlightMessageCommand: MenuCommand = {
	options: {
		name: "remove message from highlights",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot) => {
		try {
			if (ctx.targetMessage.author.username !== ctx.user.username) {
				await ctx.reply(EphemeralResponse("you can only delete your own messages..."));
				return;
			}

			const starboardService = await bot.container.getService("Starboard");
			const starred = await starboardService.isMsgStarred(ctx.targetId);

			if (!starred) {
				await ctx.reply(
					EphemeralResponse(
						`This command only works on messages that have been posted to the highlight channels (<#${discordConfig.channels.h}>, <#${discordConfig.channels.hArt}>).`
					)
				);
				return;
			}

			// get the channel the original message was posted in and what highlight channel it was posted to
			const channel = (await ctx.channel?.fetch()) as Discord.TextChannel;
			let targetChannel: Discord.TextChannel | undefined;
			switch (channel.parentId) {
				case discordConfig.channels.postYourStuff:
					targetChannel = bot.getTextChannel(discordConfig.channels.hArt);
					break;
				default:
					if (channel.id === discordConfig.channels.artChat) {
						targetChannel = bot.getTextChannel(discordConfig.channels.hArt);
						break;
					}
					targetChannel = bot.getTextChannel(discordConfig.channels.h);
					break;
			}

			// get the message from the highlight channel and delete it
			const messages = await targetChannel?.messages.fetch();
			const targetMessage = messages?.find(
				// this will not get messages that have been edited in post like replies
				m =>
					m.author.username === ctx.user.username &&
					m.content === ctx.targetMessage.content &&
					m.attachments.size > 0 &&
					m.attachments.first()?.name === ctx.targetMessage.attachments.first()?.name
			);
			const deleted = await targetMessage?.delete().catch(console.error);

			if (deleted) {
				await ctx.reply(EphemeralResponse("👍"));
				bot.getTextChannel(bot.config.channels.log)?.send(
					`Highlighted Message ${ctx.targetMessage} (${ctx.targetId}) in ${ctx.channel} deleted by ${ctx.user} (${ctx.user.id})`
				);
			} else {
				await ctx.reply(
					EphemeralResponse(
						"something went wrong with deleting your message :( ping @techbot if you want it removed"
					)
				);
			}
		} catch (error) {
			console.error("[RemoveHighlightMessage]", error);
			await ctx.reply(
				EphemeralResponse(
					"something went wrong with deleting your message :( ping @techbot if you want it removed"
				)
			);
		}
	},
};
