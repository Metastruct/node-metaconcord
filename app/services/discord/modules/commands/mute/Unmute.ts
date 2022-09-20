import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";
import { GuildMember } from "discord.js";

export class SlashUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "unmute",
			description: "Unmutes an user.",
			guildIDs: [bot.config.guildId],
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

		const guild = this.bot.discord.guilds.cache.get(config.guildId);
		if (guild) {
			let member: GuildMember;
			try {
				member = await guild.members.fetch(userId);
			} catch {
				return EphemeralResponse(
					"Couldn't get that User, probably left the guild already..."
				);
			}

			await member.roles.remove(config.mutedRoleId);
			return `${member.toString()} has been unmuted by ${ctx.user.toString()}.`;
		} else {
			return EphemeralResponse("how#3");
		}
	}
}
