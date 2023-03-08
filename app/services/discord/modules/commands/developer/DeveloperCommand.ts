import {
	CommandContext,
	SlashCommand,
	SlashCommandOptions,
	SlashCreator,
	User,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { Rule } from "../../..";

export class SlashDeveloperCommand extends SlashCommand {
	protected bot: DiscordBot;

	constructor(
		bot: DiscordBot,
		creator: SlashCreator,
		{ name, description, deferEphemeral, options, throttling, unknown }: SlashCommandOptions
	) {
		super(creator, {
			name,
			description,
			deferEphemeral,
			guildIDs: [bot.config.bot.primaryGuildId],
			forcePermissions: true,
			options,
			requiredPermissions: ["MANAGE_ROLES"],
			throttling,
			unknown,
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	private async isAllowed(user: User): Promise<boolean> {
		try {
			const res = (await this.bot.getGuildMember(user.id))?.roles.cache.has(
				this.bot.config.roles.developer
			);
			return res ?? false;
		} catch {
			return false;
		}
	}

	async isElevated(user: User): Promise<boolean> {
		try {
			const res = (await this.bot.getGuildMember(user.id))?.roles.cache.has(
				this.bot.config.roles.elevated
			);
			return res ?? false;
		} catch {
			return false;
		}
	}

	public async getRules(): Promise<Array<Rule>> {
		const data = this.bot.container.getService("Data");
		return data?.rules ?? [];
	}

	public async saveRules(rules: Array<Rule>): Promise<void> {
		const data = this.bot.container.getService("Data");
		if (data) {
			data.rules = rules;
			await data.save();
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected async runProtected(ctx: CommandContext): Promise<any> {
		throw new Error("runProtected is not defined");
	}
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	protected async runExtraProtected(ctx: CommandContext): Promise<any> {
		throw new Error("runExtraProtected is not defined");
	}

	public async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(this.deferEphemeral);

		if (await this.isAllowed(ctx.user)) {
			return this.runProtected(ctx);
		}
		if (await this.isElevated(ctx.user)) {
			return this.runExtraProtected(ctx);
		}

		return EphemeralResponse("You are not allowed to use this command.");
	}
}
