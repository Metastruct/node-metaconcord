import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { onBeforeRun } from "./MuteCommand";
import config from "@/discord.json";
import moment from "moment";
export class SlashWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whymute",
			description:
				"Prints the reason of a member's muting. You can omit the argument to check your own details, if any.",
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description: "The discord user for which we want the reason of the mute",
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	onBeforeRun = onBeforeRun;

	async run(ctx: CommandContext): Promise<string> {
		const userId = ctx.options.user.toString();
		const { muted } = this.bot.container.getService("Data");
		if (muted && muted[userId]) {
			const { until, reason, muter } = muted[userId];
			const mutedMember = await this.bot.discord.rest.fetchGuildMember(
				config.guildId,
				userId
			);
			const muterMember = await this.bot.discord.rest.fetchGuildMember(config.guildId, muter);

			const content =
				`${ctx.user.mention}, ` +
				(ctx.user.id == userId
					? `you remain muted`
					: `user **${mutedMember.toString()}** (\`${mutedMember.id}\`) remains muted`) +
				(until
					? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*`
					: "") +
				(muterMember ? ` by **${muterMember.toString()}** (\`${muterMember.id}\`)` : "") +
				(reason ? ` with reason:\n\n${reason}` : " without a reason") +
				`.`;
			return content;
		}
	}
}
