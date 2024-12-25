import { EphemeralResponse } from ".";
import { MenuCommand } from "@/extensions/discord";
import Discord from "discord.js";
import discordConfig from "@/config/discord.json";

export const MenuRemoveHighlightMessageCommand: MenuCommand = {
	options: {
		name: "remove highlighted message",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot) => {
		const starred = bot.container.getService("Starboard")?.isMsgStarred(ctx.targetId);
		if (!starred) {
			await ctx.reply(
				EphemeralResponse(
					"this command only work on messages that have been posted to the highlight channels..."
				)
			);
			return;
		}

		if (ctx.targetMessage.author.username !== ctx.user.username) {
			await ctx.reply(EphemeralResponse("you can only delete your own messages..."));
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
	},
};
