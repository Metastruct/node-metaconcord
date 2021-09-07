import {
	ApplicationCommandPermissionType,
	ApplicationCommandType,
	CommandContext,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";
import { GuildMember } from "discord.js";

export class UIMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Mute User",
			description: "Mutes an user.",
			type: ApplicationCommandType.USER,
			guildIDs: [bot.config.guildId],
			defaultPermission: false,
			permissions: {
				[bot.config.guildId]: [
					{
						type: ApplicationCommandPermissionType.ROLE,
						id: bot.config.developerRoleId,
						permission: true,
					},
				],
			},
		});

		this.filePath = __filename;
		this.bot = bot;
		this.data = this.bot.container.getService("Data");
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const { discord, config } = this.bot;
		let { muted } = this.data;
		const userId = ctx.targetID;

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { until: undefined, reason: undefined, muter: ctx.user.id };
		await this.data.save();

		const guild = discord.guilds.cache.get(this.bot.config.guildId);
		let member: GuildMember;
		try {
			member = await guild.members.fetch(userId);
		} catch {
			return EphemeralResponse("Couldn't get that User, probably left the guild already...");
		}
		await member.roles.add(config.mutedRoleId, "muted via rightclick menu command");

		const content = `${member.mention} has been muted.`;
		return EphemeralResponse(content);
	}
}
