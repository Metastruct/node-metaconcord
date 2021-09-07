import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";

export class SlashUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "unmute",
			description: "Unmutes an user.",
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

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const userId = ctx.targetID;

		const { config } = this.bot;
		let { muted } = this.data;

		if (!muted) muted = this.data.muted = {};
		delete muted[userId];
		await this.data.save();

		const guild = this.bot.discord.guilds.cache.get(ctx.guildID);
		if (guild) {
			const member = await guild.members.fetch(userId);
			if (!member) return EphemeralResponse("Invalid user.");

			await member.roles.remove(config.mutedRoleId);
			return EphemeralResponse(`${member.id} has been unmuted.`);
		} else {
			return EphemeralResponse("how#3");
		}
	}
}
