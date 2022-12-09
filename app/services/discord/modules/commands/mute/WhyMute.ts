import {
	ApplicationCommandType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data, DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";

export class SlashWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whymute",
			description: "Prints the reason and duration for a muted user.",
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description:
						"The Discord user for which we want the reason/duration of the mute",
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const userId = (ctx.options.user ?? ctx.user.id).toString();
		const { muted } = this.data;
		if (muted && muted[userId]) {
			const { at, until, reason, muter } = muted[userId];
			const guild = await this.bot.discord.guilds.fetch(
				ctx.guildID ?? this.bot.config.guildId
			);
			if (guild) {
				const content =
					`${ctx.user.mention}, ` +
					(ctx.user.id == userId ? `you remain muted` : `<@${userId}> remains muted`) +
					(until ? ` expires <t:${until}:R> from now` : "") +
					(muter ? ` by <@${muter}>` : "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					(at ? `\n\nmuted since: <t:${at.toString().substring(0, 10)}:R>` : "") +
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

// UI Commands
export class UIWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Mute Reason",
			guildIDs: [bot.config.guildId],
			type: ApplicationCommandType.USER,
		});

		this.filePath = __filename;
		this.bot = bot;
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const userId = (ctx.targetID ?? ctx.user.id).toString();
		const { muted } = this.data;
		if (muted && muted[userId]) {
			const { at, until, reason, muter } = muted[userId];
			const guild = this.bot.discord.guilds.cache.get(ctx.guildID ?? this.bot.config.guildId);
			if (guild) {
				const content =
					(ctx.user.id == userId ? `you remain muted` : `<@${userId}> remains muted`) +
					(until ? ` expires <t:${until}:R> from now` : "") +
					(muter ? ` by <@${muter}>` : "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					(at ? `\n\nmuted since: <t:${at.toString().substring(0, 10)}:R>` : "") +
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
