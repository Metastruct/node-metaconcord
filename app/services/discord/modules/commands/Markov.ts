import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const SlashMarkovCommand: SlashCommand = {
	options: {
		name: "mk",
		description: "Funny text generation based off the gmod and discord chats.",
		options: [
			{
				name: "sentence",
				description: "sentence to use",
				type: Discord.ApplicationCommandOptionType.String,
			},
			{
				name: "insanity",
				description: "more crazy output",
				type: Discord.ApplicationCommandOptionType.Integer,
				choices: [
					{ name: "normal", value: 4 },
					{ name: "sane", value: 3 },
					{ name: "insane", value: 2 },
					{ name: "crazy", value: 1 },
				],
			},
			{
				name: "length",
				description: "length of the chain 1 - 50",
				type: Discord.ApplicationCommandOptionType.Integer,
				min_value: 1,
				max_value: 50,
			},
			{
				name: "continuation",
				description: "should it include your sentence in the response?",
				type: Discord.ApplicationCommandOptionType.Boolean,
			},
		],
	},
	execute: async (ctx, bot) => {
		await ctx.deferReply();

		const res = await bot.container
			.getService("Markov")
			?.generate(ctx.options.getString("sentence") ?? undefined, {
				depth: ctx.options.getInteger("insanity") ?? undefined,
				length: ctx.options.getInteger("length") ?? undefined,
				continuation: ctx.options.getBoolean("continuation") ?? undefined,
			});

		if (res) {
			await ctx.followUp(res);
		} else {
			await ctx.deleteReply();
		}
	},
};
