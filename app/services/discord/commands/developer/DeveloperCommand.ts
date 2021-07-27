import {
	ApplicationCommandPermissionType,
	SlashCommand,
	SlashCommandOptions,
	SlashCreator,
	User,
} from "slash-create";
import { DiscordBot } from "@/app/services";

export class SlashDeveloperCommand extends SlashCommand {
	protected bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator, opts: SlashCommandOptions) {
		super(creator, {
			name: opts.name,
			description: opts.description,
			deferEphemeral: opts.deferEphemeral,
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
			options: opts.options,
			requiredPermissions: opts.requiredPermissions,
			throttling: opts.throttling,
			unknown: opts.unknown,
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	protected async isAllowed(user: User): Promise<boolean> {
		const guild = await this.bot.discord.guilds.resolve(this.bot.config.guildId)?.fetch();
		const devRole = guild.roles.resolve(this.bot.config.developerRoleId);
		return devRole.members.has(user.id);
	}
}
