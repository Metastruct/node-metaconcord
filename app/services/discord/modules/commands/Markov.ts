import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { MarkovService } from "../../../Markov";
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
					name: "crazy",
					description: "more crazy output",
					type: CommandOptionType.BOOLEAN,
				},
				{
					name: "length",
					description: "length of the chain",
					type: CommandOptionType.INTEGER,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
		const markov = this.bot.container.getService("Markov");
		if (!markov) return;
		this.markov = markov;
	}

	async run(ctx: CommandContext): Promise<void> {
		await ctx.defer();
		try {
			const res = await this.markov.generate(
				ctx.options.sentence,
				ctx.options.crazy ? 1 : undefined,
				ctx.options.length > 50 ? 50 : ctx.options.length ?? 50
			);
			await ctx.send(res);
		} catch (err) {
			await ctx.delete();
		}
	}
}
