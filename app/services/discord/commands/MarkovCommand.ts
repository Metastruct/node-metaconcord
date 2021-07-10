import { CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "..";
import { MarkovService } from "../../Markov";
import EphemeralResponse from ".";

export class SlashMarkovCommand extends SlashCommand {
	private bot: DiscordBot;
	private markov: MarkovService;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mk",
			description: "Funny text generation based off the gmod and discord chats.",
			guildIDs: [bot.config.guildId],
			options: [],
			throttling: {
				usages: 1,
				duration: 60,
			},
		});
		this.filePath = __filename;
		this.bot = bot;
		this.markov = this.bot.container.getService("Markov");
	}

	async run(ctx: CommandContext): Promise<any> {
		const building = this.markov.building;
		if (building) return EphemeralResponse("Markov is not ready yet! Try again later...");
		ctx.send("Generating Markov...");
		ctx.send(this.markov.generate());
	}
}
