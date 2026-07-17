import * as Discord from "discord.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import config from "@/config/discord.json" with { type: "json" };
import { logger, sleep } from "@/utils.js";

const log = logger(import.meta);

export default class DiscordClient extends Discord.Client {
	config = config;
	gameServer: GameServer;
	ready: boolean;

	constructor(gameServer: GameServer, options: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;

		this.on("clientReady", () => {
			this.ready = true;
		});

		this.on("shardDisconnect", () => {
			this.ready = false;
		});

		this.on("shardResume", () => {
			this.ready = true;
		});

		this.on("error", err => {
			log.error(err, "Game bridge Discord client error");
		});

		this.on("warn", log.warn);
	}

	public run(token: string): void {
		this.connect(token);
	}

	private async connect(token: string): Promise<void> {
		let attempts = 0;
		while (true) {
			try {
				await this.login(token);
				return;
			} catch (err) {
				attempts++;
				const delay = Math.min(5000 * 2 ** (attempts - 1), 120_000);
				log.error(
					{ err, attempt: attempts },
					`Game bridge Discord login failed, retrying in ${delay}ms`
				);
				await sleep(delay);
			}
		}
	}

	public async isAllowed(user: Discord.User): Promise<boolean> {
		try {
			const discord = this.gameServer.discord;
			const guild = await discord.guilds.fetch(discord.config.bot.primaryGuildId);
			if (!guild) return false;

			const member = await guild.members.fetch(user.id);
			if (!member) return false;

			return member.roles.cache.hasAny(
				discord.config.roles.newDeveloper,
				discord.config.roles.developer,
				discord.config.roles.administrator
			);
		} catch {
			return false;
		}
	}
}
