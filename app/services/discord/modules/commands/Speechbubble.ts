import {
	CommandContext,
	CommandOptionType,
	MessageOptions,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import { makeSpeechBubble } from "@/utils";

export class SlashSpeechbubbleCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "speechbubble",
			description: "create your own speechbubble gifs",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "link",
					description: "image link",
				},
				{
					type: CommandOptionType.ATTACHMENT,
					name: "image",
					description: "file on your device",
				},
				{
					type: CommandOptionType.INTEGER,
					name: "direction",
					description: "tail direction",
					choices: [
						{ name: "left", value: 0 },
						{ name: "right", value: 1 },
					],
				},
				{
					type: CommandOptionType.STRING,
					name: "line_color",
					description:
						"CSS style color for the speech bubble (default = transparent rba(0,0,0,0))",
				},
				{
					type: CommandOptionType.NUMBER,
					name: "line_width",
					description: "how thicc the line is (default = 1)",
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<MessageOptions | undefined> {
		const link: string | undefined = ctx.options.link;
		const image: string | undefined = ctx.options.image;
		if (link && image)
			return EphemeralResponse("can't do shit with both, either one or the other");
		if (!link && !image)
			return EphemeralResponse("I can't read your mind, specify a file or link");
		if (link && !link.match(/^https?:\/\/.+\..+$/g))
			return EphemeralResponse("link seems to be invalid");
		try {
			await ctx.defer();
			const attachment = ctx.attachments.first();
			const buffer = await makeSpeechBubble(
				link ? link : attachment?.url ?? "",
				ctx.options.direction === 1 ? true : false,
				ctx.options.line_color,
				ctx.options.line_width
			);
			ctx.send({
				file: {
					name: "funny.gif",
					file: buffer,
				},
			} as MessageOptions);
		} catch (err) {
			return EphemeralResponse(`something went wrong! (${err})`);
		}
	}
}
