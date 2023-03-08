import {
	ApplicationCommandType,
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
			guildIDs: [bot.config.bot.primaryGuildId],
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
					name: "fill_color",
					description:
						"CSS style color for the speech bubble (default = transparent example: rba(255,0,0,0.5))",
				},
				{
					type: CommandOptionType.STRING,
					name: "line_color",
					description:
						"CSS style color for the speech bubble outline (default = transparent example: rba(255,0,0,0.5))",
				},
				{
					type: CommandOptionType.NUMBER,
					name: "line_width",
					description: "how thicc the line is (default = 4)",
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
			const attachment = ctx.attachments.first();
			const buffer = await makeSpeechBubble(
				link ? link : attachment?.url ?? "",
				ctx.options.direction === 1 ? true : false,
				ctx.options.fill_color,
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

// UI Commands
export class UISpeechbubbleRightCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "speechbubble right",
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
				: sticker.format_type === 4
				? `https://cdn.discordapp.com/stickers/${sticker.id}.gif`
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
export class UISpeechbubbleLeftCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "speechbubble left",
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
				: sticker.format_type === 4
				? `https://cdn.discordapp.com/stickers/${sticker.id}.gif`
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
