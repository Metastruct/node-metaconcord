import {
	ApplicationCommandType,
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
			guildIDs: [bot.config.bot.primaryGuildId],
			requiredPermissions: ["MANAGE_ROLES"],
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
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const userId = ctx.options.user;

		const { config } = this.bot;
		let { muted } = this.data;

		if (!muted) muted = this.data.muted = {};
		delete muted[userId];
		await this.data.save();

		const guild = this.bot.getGuild();
		if (guild) {
			const member = await this.bot.getGuildMember(userId);
			if (!member) return "Couldn't get that User, probably left the guild already...";
			await member.roles.remove(config.roles.muted);
			return `${member.mention} has been unmuted by ${ctx.user.mention}.`;
		} else {
			return EphemeralResponse("how#3");
		}
	}
}

// UI Commands
export class UIUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Unmute User",
			type: ApplicationCommandType.USER,
			guildIDs: [bot.config.bot.primaryGuildId],
			requiredPermissions: ["MANAGE_ROLES"],
		});

		this.filePath = __filename;
		this.bot = bot;
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const userId = ctx.targetID;
		if (!userId) return;

		const { config } = this.bot;
		let { muted } = this.data;

		if (!muted) muted = this.data.muted = {};
		delete muted[userId];
		await this.data.save();

		const guild = this.bot.getGuild();
		if (guild) {
			const member = await this.bot.getGuildMember(userId);
			if (!member) return "Couldn't get that User, probably left the guild already...";
			await member.roles.remove(config.roles.muted);
			return EphemeralResponse(`${member} has been unmuted.`);
		} else {
			return EphemeralResponse("how#3");
		}
	}
}
