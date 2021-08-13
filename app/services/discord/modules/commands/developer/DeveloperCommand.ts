import {
	ApplicationCommandPermissionType,
	CommandContext,
	SlashCommand,
	SlashCommandOptions,
	SlashCreator,
	User,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";

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

	private async isAllowed(user: User): Promise<boolean> {
		try {
			const guild = await this.bot.discord.guilds.resolve(this.bot.config.guildId)?.fetch();
			if (!guild) return false;

			const member = await guild.members.resolve(user.id)?.fetch();
			if (!member) return false;

			return member.roles.cache.has(this.bot.config.developerRoleId);
		} catch {
			return false;
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected async runProtected(ctx: CommandContext): Promise<any> {
		throw new Error("runProtected is not defined");
	}

	public async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();

		if (!this.isAllowed(ctx.user)) {
			return EphemeralResponse("You are not allowed to use this command.");
		}

		return this.runProtected(ctx);
	}
}
