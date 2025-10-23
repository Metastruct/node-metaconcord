import * as Discord from "discord.js";
import { SlashCommand } from "@/extensions/discord.js";
import { Shat } from "../shitposting.js";

export const SlashRandomImageCommand: SlashCommand = {
	options: {
		name: "randomimage",
		description: "post a random image from the time machine...",
	},
	execute: async ctx => {
		await ctx.deferReply();

		const res = await Shat({ forceImage: true });

		if (res) {
			await ctx.followUp(res as Discord.InteractionReplyOptions);
		} else {
			await ctx.deleteReply();
		}
	},
};
