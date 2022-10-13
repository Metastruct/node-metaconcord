import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { MarkovService } from "../../../Markov";
import { clamp } from "@/utils";
export class SlashMarkovCommand extends SlashCommand {
	private bot: DiscordBot;
	private markov: MarkovService;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mk",
			description: "Funny text generation based off the gmod and discord chats.",
			guildIDs: [bot.config.guildId],
			options: [
				{
					name: "sentence",
					description: "sentence to use",
					type: CommandOptionType.STRING,
				},
				{
					name: "insanity",
					description: "more crazy output",
					type: CommandOptionType.NUMBER,
					autocomplete: true,
				},
				{
					name: "length",
					description: "length of the chain 1 - 50",
					type: CommandOptionType.INTEGER,
				},
				{
					name: "user",
					description: "does exactly what you think it does.",
					type: CommandOptionType.USER,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
		const markov = this.bot.container.getService("Markov");
		if (!markov) return;
		this.markov = markov;
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
		if (ctx.focused && ctx.focused == "insanity") {
			return [
				{ name: "sane", value: 3 },
				{ name: "insane", value: 2 },
				{ name: "crazy", value: 1 },
			];
		}
		return [];
	}

	async run(ctx: CommandContext): Promise<void> {
		await ctx.defer();

		const res = await this.markov.generate(
			ctx.options.sentence,
			ctx.options.insanity ? clamp(ctx.options.insanity, 1, 3) : undefined,
			ctx.options.length ? clamp(ctx.options.length, 1, 50) : undefined,
			ctx.options.user
		);

		if (res) {
			await ctx.send(res);
		} else {
			await ctx.delete();
		}
	}
}
