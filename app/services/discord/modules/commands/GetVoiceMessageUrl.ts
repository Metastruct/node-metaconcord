import { EphemeralResponse } from ".";
import { MenuCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const MenuGetVoiceMessageUrlCommand: MenuCommand = {
	options: {
		name: "get voice message url",
		type: Discord.ApplicationCommandType.Message,
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction) => {
		if (ctx.targetMessage.attachments.size === 0) {
			await ctx.reply(EphemeralResponse("no attachments found in this message..."));
			return;
		}
		const voiceUris = ctx.targetMessage.attachments.find(a => a.waveform !== null && a.url);
		if (!voiceUris) {
			await ctx.reply(EphemeralResponse("no voice messages found in this message..."));
			return;
		}
		await ctx.reply({
			content: voiceUris.url,
			flags: Discord.MessageFlags.Ephemeral,
		});
	},
};
