import { CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "..";
import { MarkovService } from "../../Markov";
export class SlashMarkovCommand extends SlashCommand {
	private bot: DiscordBot;
	private markov: MarkovService;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mk",
			description: "Funny text generation based off the gmod and discord chats.",
			guildIDs: [bot.config.guildId],
			options: [],
		});
		this.filePath = __filename;
		this.bot = bot;
		this.markov = this.bot.container.getService("Markov");
	}

	async run(ctx: CommandContext): Promise<void> {
		await ctx.defer();
		await ctx.send(this.markov.generate());
	}
}
