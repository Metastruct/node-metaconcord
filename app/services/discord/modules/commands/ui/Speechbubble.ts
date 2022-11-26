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

export class UISpeechbubbleRightCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "create rightfacing speechbubble",
			deferEphemeral: true,
			type: ApplicationCommandType.MESSAGE,
		});
		this.filePath = __filename;
	}

	async run(ctx: CommandContext): Promise<MessageOptions | undefined> {
		const msg = ctx.targetMessage;

		const hack = ctx.data.data.resolved?.messages as any;
		const sticker =
			ctx.targetID && hack
				? hack[ctx.targetID].sticker_items
					? hack[ctx.targetID].sticker_items.length > 0
						? hack[ctx.targetID].sticker_items[0]
						: undefined
					: undefined
				: undefined;

		const link: string | undefined = sticker
			? sticker.format_type < 3
				? `https://cdn.discordapp.com/stickers/${sticker.id}.png`
				: undefined
			: msg?.content.match(/^https?:\/\/.+\..+$/g)
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
export class UISpeechbubbleLeftCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "create leftfacing speechbubble",
			deferEphemeral: true,
			type: ApplicationCommandType.MESSAGE,
		});
		this.filePath = __filename;
	}

	async run(ctx: CommandContext): Promise<MessageOptions | undefined> {
		const msg = ctx.targetMessage;

		const hack = ctx.data.data.resolved?.messages as any;
		const sticker =
			ctx.targetID && hack
				? hack[ctx.targetID].sticker_items
					? hack[ctx.targetID].sticker_items.length > 0
						? hack[ctx.targetID].sticker_items[0]
						: undefined
					: undefined
				: undefined;

		const link: string | undefined = sticker
			? sticker.format_type < 3
				? `https://cdn.discordapp.com/stickers/${sticker.id}.png`
				: undefined
			: msg?.content.match(/^https?:\/\/.+\..+$/g)
			? msg.content
			: msg?.attachments
			? msg.attachments.length > 0
				? msg.attachments[0].url
				: undefined
			: undefined;

		if (!link)
			return EphemeralResponse("that message doesn't have a link or attachment I can use!");
		try {
			const buffer = await makeSpeechBubble(link, true);
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
