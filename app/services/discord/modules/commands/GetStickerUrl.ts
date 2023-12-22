import { EphemeralResponse } from ".";
import { MenuCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const MenuGetStickerUrlCommand: MenuCommand = {
	options: {
		name: "get sticker url",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction) => {
		if (ctx.targetMessage.stickers.size === 0) {
			await ctx.reply(EphemeralResponse("no stickers found in this message..."));
			return;
		}
		const stickers = ctx.targetMessage.stickers;
		await ctx.reply({
			content: stickers
				.map(
					s =>
						`${s.url}${
							s.format === Discord.StickerFormatType.APNG
								? "\n(APNG don't animate on Discord)"
								: ""
						}`
				)
				.join("\n"),
			ephemeral: true,
		});
	},
};
