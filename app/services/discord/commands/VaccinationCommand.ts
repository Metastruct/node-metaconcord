import { CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "..";
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
		await ctx.defer(true);
		return await this.addRole(ctx);
	}

	async addRole(ctx: CommandContext): Promise<string> {
		const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
		if (!guild) return;

		const member = await guild.members.fetch(ctx.member.id);

		if (member.roles.cache.get(VACCINATION_ROLE)) {
			return "You are already vaccinated!";
		}

		await member.roles.add(VACCINATION_ROLE);

		return "You just got vaccinated!";
	}
}
