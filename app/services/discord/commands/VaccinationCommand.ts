import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "..";
import Discord from "discord.js";
import EphemeralResponse from ".";
import config from "@/discord-extras.json";

const VACCINATION_ROLE = config.roles.vaccination;

export class SlashVaccinatedCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "vaccinated",
			description: "Gives you a vaccinated role.",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		return this.addRole(ctx);
	}

	async addRole(ctx: CommandContext): Promise<any> {
		const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
		if (!guild) {
			return EphemeralResponse("Not in a guild");
		}

		const member = await guild.members.fetch(ctx.member.id);
		await member.roles.add(VACCINATION_ROLE);

		return EphemeralResponse("You got vaccinated!");
	}
}
