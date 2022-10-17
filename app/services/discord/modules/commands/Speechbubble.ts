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
			if (!attachment) return EphemeralResponse("couldn't read attachment?");
			const buffer = await makeSpeechBubble(link ? link : attachment.url);
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
