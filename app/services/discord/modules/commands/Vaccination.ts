import { CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import config from "@/config/discord.json";

const VACCINATION_ROLE = config.roles.vaccination;

export class SlashVaccinatedCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "vaccinated",
			description: "Gives you a vaccinated role.",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		return await this.addRole(ctx);
	}

	async addRole(ctx: CommandContext): Promise<string> {
		const member = await this.bot.getGuildMember(ctx.user.id);
		if (!member) return "Something went wrong! Try again...";
		if (member?.roles.cache.get(VACCINATION_ROLE)) {
			return "You are already vaccinated!";
		}

		await member?.roles.add(VACCINATION_ROLE);

		return "You just got vaccinated!";
	}
}
