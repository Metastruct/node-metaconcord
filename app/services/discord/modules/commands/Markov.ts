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
			const res = await this.markov.generate();
			await ctx.send(res);
		} catch (err) {
			await ctx.delete();
		}
	}
}
