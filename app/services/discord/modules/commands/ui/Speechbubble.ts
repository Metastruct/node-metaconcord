import {
	ApplicationCommandType,
	CommandContext,
	MessageOptions,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "../";
import { makeSpeechBubble } from "@/utils";

export class UISpeechbubbleCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Create Speechbubble",
			deferEphemeral: true,
			type: ApplicationCommandType.MESSAGE,
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<MessageOptions | undefined> {
		const msg = ctx.targetMessage;
		const link: string | undefined = msg?.content.match(/^https?:\/\/.+\..+$/g)
			? msg.content
			: msg?.attachments
			? msg.attachments.length > 0
				? msg.attachments[0].url
				: undefined
			: undefined;

		if (!link)
			return EphemeralResponse("that message doesn't have a link or attachment I can use!");
		try {
			const buffer = await makeSpeechBubble(link);
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
