import * as Discord from "discord.js";
import { SlashCommand } from "@/extensions/discord.js";

export const SlashMarkovCommand: SlashCommand = {
	options: {
		name: "mk",
		description: "Funny text generation based off the gmod and discord chats.",
		options: [
			{
				name: "generate",
				description: "generates the funny",
				type: Discord.ApplicationCommandOptionType.Subcommand,
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
			{
				name: "similar",
				description: "finds a similar word",
				type: Discord.ApplicationCommandOptionType.Subcommand,
				options: [
					{
						name: "word",
						description: "word to search for",
						required: true,
						type: Discord.ApplicationCommandOptionType.String,
					},
					{
						name: "distance",
						description: "how many edits are allowed?",
						type: Discord.ApplicationCommandOptionType.Integer,
						min_value: 1,
					},
				],
			},
		],
	},
	execute: async (ctx, bot) => {
		await ctx.deferReply();

		const cmd = ctx.options.getSubcommand(true);

		let res: string | undefined = undefined;
		switch (cmd) {
			case "generate":
				res = await bot.container
					.getService("Markov")
					.generate(ctx.options.getString("sentence") ?? undefined, {
						depth: ctx.options.getInteger("insanity") ?? undefined,
						length: ctx.options.getInteger("length") ?? undefined,
						continuation: ctx.options.getBoolean("continuation") ?? undefined,
					});
				break;
			case "similar":
				res =
					(await bot.container
						.getService("Markov")
						.findClosestWord(
							ctx.options.getString("word", true),
							ctx.options.getInteger("distance") ?? 1
						)) ?? undefined;
				break;
			default:
				break;
		}

		if (res) {
			await ctx.followUp(res);
		} else {
			await ctx.deleteReply();
		}
	},
};
