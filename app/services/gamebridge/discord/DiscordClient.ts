import Discord, { User } from "discord.js";
import GameServer from "../GameServer";
import config from "@/config/discord.json";

export default class DiscordClient extends Discord.Client {
	gameServer: GameServer;
	config = config;

	constructor(gameServer: GameServer, options: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;

		this.on("warn", console.log);
	}

	public run(token: string): void {
		this.login(token);
	}

	public static async isAllowed(server: GameServer, user: User): Promise<boolean> {
		try {
			const discord = server.discord;
			const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
			if (!guild) return false;

			const member = await guild.members.fetch(user.id);
			if (!member) return false;

			return member.roles.cache.has(discord.config.roles.developer);
		} catch {
			return false;
		}
	}
}
