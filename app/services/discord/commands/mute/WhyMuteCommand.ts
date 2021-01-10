import { BaseCommand } from "..";
import { Command } from "detritus-client";
import { DiscordBot } from "../..";
import { onBeforeRun } from "./MuteCommand";
import moment from "moment";

export default class WhyMuteCommand extends BaseCommand {
	constructor(bot: DiscordBot) {
		super(bot, {
			name: "whymute",
			label: "userId",
			disableDm: true,
			metadata: {
				help:
					"Prints the reason of a member's muting. You can omit the argument to check your own details, if any.",
				usage: ["!whymute <UserID?>", `#MENTION whymute <UserID?>`],
			},
		});
	}

	onBeforeRun = onBeforeRun;

	async run(ctx: Command.Context, { userId }: Command.ParsedArgs): Promise<void> {
		const { muted } = this.data;
		if (muted && muted[userId]) {
			const { until, reason, muter } = this.data.muted[userId];
			const mutedMember = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
			const muterMember = await ctx.rest.fetchGuildMember(ctx.guildId, muter);

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
			if (ctx.canReply) {
				ctx.reply(content);
			} else {
				ctx.user.createMessage(content);
			}
			ctx.message.delete();
		}
	}
}
