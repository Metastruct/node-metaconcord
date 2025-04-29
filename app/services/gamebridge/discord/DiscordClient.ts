import * as Discord from "discord.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import config from "@/config/discord.json" assert { type: "json" };

export default class DiscordClient extends Discord.Client {
	config = config;
	gameServer: GameServer;
	ready: boolean;

	constructor(gameServer: GameServer, options: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;

		this.on("ready", () => {
			this.ready = true;
		});

		this.on("shardDisconnect", () => {
			this.ready = false;
		});

		this.on("warn", console.log);
	}

	public run(token: string): void {
		this.login(token);
	}

	public async isAllowed(user: Discord.User): Promise<boolean> {
		try {
			const discord = this.gameServer.discord;
			const guild = await discord.guilds.fetch(discord.config.bot.primaryGuildId);
			if (!guild) return false;

			const member = await guild.members.fetch(user.id);
			if (!member) return false;

			return member.roles.cache.hasAny(
				discord.config.roles.developer,
				discord.config.roles.administrator
			);
		} catch {
			return false;
		}
	}
}
