import { EphemeralResponse } from ".";
import { MenuCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const MenuRemoveHighlightMessageCommand: MenuCommand = {
	options: {
		name: "remove highlighted message",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot) => {
		if (
			!ctx.targetMessage.webhookId ||
			(ctx.targetMessage.channel as Discord.GuildChannel).parentId !==
				bot.config.categories.highlights
		) {
			await ctx.reply(
				EphemeralResponse("this command only works in the highlight channels...")
			);
			return;
		}

		if (ctx.targetMessage.author.username !== ctx.user.username) {
			await ctx.reply(EphemeralResponse("you can only delete your own messages..."));
			return;
		}

		const deleted = await ctx.targetMessage.delete().catch(console.error);

		if (deleted) {
			await ctx.reply(EphemeralResponse("👍"));
			bot.getTextChannel(bot.config.channels.log)?.send(
				`Highlighted Message ${ctx.targetMessage} (${ctx.targetId}) in ${ctx.channel} deleted by ${ctx.user} (${ctx.user.id})`
			);
		} else {
			await ctx.reply(
				EphemeralResponse("something went wrong with deleting your message :(")
			);
		}
	},
};
