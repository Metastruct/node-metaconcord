import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import moment from "moment";
import Silent from "../";

export class SlashWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whymute",
			description: "Prints the reason of a member's muting.",
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description: "The Discord user for which we want the reason of the mute",
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		const userId = (ctx.options.user ?? ctx.user.id).toString();
		const { muted } = this.bot.container.getService("Data");
		if (muted && muted[userId]) {
			const { until, reason, muter } = muted[userId];
			const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
			if (guild) {
				const mutedMember = await guild.members.resolve(userId)?.fetch();
				const muterMember = await guild.members.resolve(muter)?.fetch();
				if (!mutedMember || !muterMember) return "invalid user";

				const content =
					`${ctx.user.mention}, ` +
					(ctx.user.id == userId
						? `you remain muted`
						: `user **${mutedMember.toString()}** (\`${
								mutedMember.id
						  }\`) remains muted`) +
					(until
						? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*`
						: "") +
					(muterMember
						? ` by **${muterMember.toString()}** (\`${muterMember.id}\`)`
						: "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					`.`;
				return Silent(content);
			} else {
				return Silent("how#3");
			}
		} else {
			if (userId == ctx.user.id) {
				return Silent("You're not muted... yet!");
			} else {
				return Silent("That user hasn't been muted... yet!");
			}
		}
	}
}
