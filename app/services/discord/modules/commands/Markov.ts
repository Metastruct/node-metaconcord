import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { MarkovService } from "../../../Markov";
import fs from "fs";
import path from "path";
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
					type: CommandOptionType.INTEGER,
					name: "score",
					description: "minimum score for the generation",
					required: false,
				},
				{
					type: CommandOptionType.BOOLEAN,
					name: "verbose",
					description: "show full makrov output",
					required: false,
				},
				{
					type: CommandOptionType.INTEGER,
					name: "length",
					description: "minimum amount of words",
					required: false,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
		this.markov = this.bot.container.getService("Markov");
	}

	async run(ctx: CommandContext): Promise<void> {
		await ctx.defer();
		try {
			const res = this.markov.generate(
				ctx.options.score,
				ctx.options.verbose,
				ctx.options.amount
			);
			if (ctx.options.verbose) {
				const fpath = path.resolve(`${Date.now()}_mkv.txt`.toLocaleLowerCase());

				await new Promise<void>((resolve, reject) =>
					fs.writeFile(fpath, res, err => (err ? reject(err.message) : resolve()))
				);

				ctx.send(JSON.parse(res).string, {
					file: {
						name: "result.json",
						file: fs.readFileSync(fpath),
					},
				});

				await new Promise<void>((resolve, reject) =>
					fs.unlink(fpath, err => (err ? reject(err.message) : resolve()))
				);
			} else {
				await ctx.send(res);
			}
		} catch (err) {
			await ctx.delete();
		}
	}
}
