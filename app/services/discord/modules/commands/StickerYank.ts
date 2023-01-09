import { ApplicationCommandType, CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";

export class UIStickerYankCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Yank Sticker URL",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			type: ApplicationCommandType.MESSAGE,
		});
		this.filePath = __filename;
	}

	async run(ctx: CommandContext): Promise<any> {
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
			: undefined;

		if (!link) return EphemeralResponse("that message doesn't have a sticker!");
		return EphemeralResponse(link);
	}
}
