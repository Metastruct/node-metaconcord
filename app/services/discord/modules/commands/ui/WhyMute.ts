import { ApplicationCommandType, CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

export class UIWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Mute Reason",
			description: "Prints the reason and duration for a muted user.",
			guildIDs: [bot.config.guildId],
			type: ApplicationCommandType.USER,
		});

		this.filePath = __filename;
		this.bot = bot;
		dayjs.extend(relativeTime);
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const userId = (ctx.targetID ?? ctx.user.id).toString();
		const { muted } = this.bot.container.getService("Data");
		if (muted && muted[userId]) {
			const { at, until, reason, muter } = muted[userId];
			const guild = this.bot.discord.guilds.cache.get(ctx.guildID);
			if (guild) {
				const content =
					(ctx.user.id == userId ? `you remain muted` : `<@${userId}> remains muted`) +
					(until ? ` expires <t:${until}:R> from now` : "") +
					(muter ? ` by <@${muter}>` : "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					(at ? `muted since: <t:${at}:R>` : "") +
					`.`;
				return EphemeralResponse(content);
			} else {
				return EphemeralResponse("how#3");
			}
		} else {
			if (userId == ctx.user.id) {
				return EphemeralResponse("You're not muted... yet!");
			} else {
				return EphemeralResponse("That user hasn't been muted... yet!");
			}
		}
	}
}
