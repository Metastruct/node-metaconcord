import { DiscordBot } from "..";
import { SlashCommand, SlashCreator } from "slash-create";

export class SlashMarkovCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mk",
			description: "Funny text generation based off the gmod and discord chats.",
			guildIDs: [bot.config.guildId],
			options: [],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(): Promise<string> {
		return this.bot.container.getService("Markov").generate();
	}
}
