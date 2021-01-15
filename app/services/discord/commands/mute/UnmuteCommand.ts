import { BaseCommand } from "..";
import { Command } from "detritus-client";
import { DiscordBot } from "../..";
import { Permissions } from "detritus-client/lib/constants";
import { onBeforeRun } from "./MuteCommand";

export default class UnmuteCommand extends BaseCommand {
	constructor(bot: DiscordBot) {
		super(bot, {
			name: "unmute",
			label: "userId",
			responseOptional: true,
			disableDm: true,
			metadata: {
				help: "Unmutes a member.",
				usage: ["!unmute <Mention/UserID>", `#MENTION unmute <Mention/UserID>`],
			},
			permissions: [Permissions.MANAGE_ROLES],
			permissionsClient: [Permissions.MANAGE_ROLES],
		});
	}

	onBeforeRun = onBeforeRun;

	async run(ctx: Command.Context, { userId }: Command.ParsedArgs): Promise<void> {
		const { config } = this.bot;
		let { muted } = this.data;

		if (!muted) muted = this.data.muted = {};
		delete muted[userId];
		await this.data.save();

		const member = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
		await member.removeRole(config.modules.mute.roleId);

		const content = `${ctx.user.mention}, user ${member.mention} has been unmuted.`;
		const mutedChannel = await ctx.rest.fetchChannel(config.mutedChannelId);
		mutedChannel.createMessage(content);
		ctx.message.delete();
	}
}
