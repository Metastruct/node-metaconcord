import * as Discord from "discord.js";
import { DiscordClient } from "./discord/index.js";
import { EventEmitter } from "events";
import GameBridge from "./GameBridge.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type GameConnectionConfig = {
	discordToken: string;
	id: number;
	label?: string;
	name: string;
};

export type Player = {
	steamId64: string;
	avatar?: string | false; // Metastruct SteamCache can return false...
	ip: string;
	isAdmin: boolean;
	isAfk?: boolean;
	isBanned: boolean;
	isLinux?: boolean;
	nick: string;
	isPirate?: boolean;
};

/**
 * Generic per-gameserver state and behavior shared by every game. Transport
 * (websocket, SignalR, polling...), wire-protocol handling, and any
 * game-specific capabilities (RCON, ssh, gamemodes, ...) live on subclasses
 * under games/<game>/.
 */
export default class GameConnection extends EventEmitter {
	config: GameConnectionConfig;
	bridge: GameBridge;
	disconnected = false;
	discord: DiscordClient;
	discordIcon: string | undefined = undefined;
	discordBanner: string | undefined = undefined;
	playerListImage: Buffer;
	status: {
		mapThumbnail?: string;
		players: Player[];
		image?: string;
	} = { players: [] };
	mapName: string;

	constructor(config: { bridge: GameBridge; serverConfig: GameConnectionConfig }) {
		super();
		this.config = config.serverConfig;
		this.bridge = config.bridge;
		this.discord = new DiscordClient(this, {
			intents: ["Guilds", "GuildMessages", "MessageContent"],
		});

		this.discord.run(this.config.discordToken);

		this.discord.on("clientReady", async client => {
			this.discordIcon = client.user.avatarURL() ?? undefined;
			this.discordBanner = client.user.bannerURL() ?? undefined;
		});

		log.info(`'${this.config.name}' Game connection created`);
	}

	async changeIcon(path: string) {
		if (!this.discord.ready) return;
		try {
			await this.discord.user?.setAvatar(path);
			this.discordIcon = path;
		} catch {}
	}

	async changeBanner(path: string) {
		if (!this.discord.ready) return;
		try {
			await this.discord.user?.setBanner(path);
			this.discordBanner = path;
		} catch {}
	}

	/**
	 * Finds this connection's own status message in the server-info channel
	 * and edits it, or sends a new one. Shared by every game's status embed so
	 * none of them have to re-implement the fetch/edit-or-send dance.
	 */
	async postOrEditStatusMessage(
		container: Discord.ContainerBuilder,
		files: Discord.AttachmentBuilder[]
	): Promise<void> {
		if (!this.discord.ready) return;

		const guild = this.discord.guilds.cache.get(this.discord.config.bot.primaryGuildId);
		if (!guild) return;

		const channel = guild.channels.cache.get(
			this.bridge.config.serverInfoChannelId
		) as Discord.TextChannel;
		if (!channel) return;

		try {
			const messages = await channel.messages.fetch();
			const message = messages
				.filter((msg: Discord.Message) => msg.author.id == this.discord.user?.id)
				.first();

			if (message) {
				await message
					.edit({
						components: [container],
						files,
						flags: Discord.MessageFlags.IsComponentsV2,
					})
					.catch(e => log.error(e, "message edit failed"));
			} else {
				await channel
					.send({
						components: [container],
						files,
						flags: Discord.MessageFlags.IsComponentsV2,
					})
					.catch(() => {});
			}
		} catch (err) {
			log.error(err);
		}
	}
}
