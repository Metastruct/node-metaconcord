import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../..";
import Silent from "../";

export class SlashUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "unmute",
			description: "Prints the reason of a member's muting.",
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
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description: "The Discord user to unmute",
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
		this.data = this.bot.container.getService("Data");
	}

	//onBeforeRun = onBeforeRun;

	async run(ctx: CommandContext): Promise<any> {
		const userId = ctx.options.user.toString();

		const { config } = this.bot;
		let { muted } = this.data;

		if (!muted) muted = this.data.muted = {};
		delete muted[userId];
		await this.data.save();

		const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
		if (guild) {
			const member = await guild.members.resolve(userId)?.fetch();
			if (!member) return Silent("Invalid user.");

			await member.roles.remove(config.modules.mute.roleId);
			return `${ctx.user.mention}, user <@${member.id}> has been unmuted.`;
		} else {
			return Silent("how#3");
		}
	}
}
