import { DiscordClient } from "./discord/index.js";
import { ErrorPayload } from "./payloads/index.js";
import {
	IUtf8Message,
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";
import { NodeSSH, SSHExecOptions } from "node-ssh";
import { RconResponse } from "./payloads/structures/index.js";
import { WebhookClient } from "discord.js";
import GameBridge from "./GameBridge.js";
import sshConfig from "@/config/ssh.json" with { type: "json" };

export type GameServerConfig = {
	defaultGamemode?: string;
	discordToken: string;
	id: number;
	ip: string;
	label?: string;
	name: string;
	ssh?: {
		host: string;
		port: number;
		username: string;
	};
};

export type Player = {
	accountId: number;
	avatar?: string | false; // Metastruct SteamCache can return false...
	ip: string;
	isAdmin: boolean;
	isAfk?: boolean;
	isBanned: boolean;
	isLinux?: boolean;
	nick: string;
	isPirate?: boolean;
};

export default class GameServer {
	connection?: WebSocketConnection;
	config: GameServerConfig;
	bridge: GameBridge;
	defcon: number;
	discord: DiscordClient;
	discordIcon: string | undefined = undefined;
	discordBanner: string | undefined = undefined;
	discordWH?: WebhookClient; // chat relay webhook
	discordEWH?: WebhookClient; // error relay webhook
	discordPEWH?: WebhookClient; // pac3 specific error webhook todo: remove???
	gamemode: {
		folderName: string;
		name: string;
	};
	gamemodes: string[];
	playerListImage: Buffer;
	serverUptime: number;
	status: {
		mapThumbnail: string | null;
		players: Player[];
		image: string | null;
	} = { mapThumbnail: null, players: [], image: null };
	mapName: string;
	mapUptime: number;
	workshopMap?: {
		name: string;
		id: string;
	};

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: GameServerConfig;
	}) {
		this.connection = config.req?.accept();
		this.config = config.serverConfig;
		this.bridge = config.bridge;
		this.discord = new DiscordClient(this, {
			intents: ["Guilds", "GuildMessages", "MessageContent"],
		});
		this.discordWH = new WebhookClient({
			url: config.bridge.config.chatWebhookUrl,
		});
		this.discordEWH = new WebhookClient({
			url: config.bridge.config.errorWebhookUrl,
		});
		this.discordPEWH = new WebhookClient({
			url: config.bridge.config.pacErrorWebhookUrl,
		});

		this.discord.run(this.config.discordToken);

		this.discord.on("ready", async client => {
			for (const [, payload] of Object.entries(config.bridge.payloads)) {
				payload.initialize(this);
			}
			this.discordIcon = client.user.avatar ?? undefined;
			this.discordBanner = client.user.banner ?? undefined;
		});

		this.connection?.on("message", async (msg: IUtf8Message) => {
			// if (received.utf8Data == "") console.log("Heartbeat");
			if (!msg || msg.utf8Data == "") return;

			let data: any;
			try {
				data = JSON.parse(msg.utf8Data);
				if (!data.name || !data.data) throw new Error("Malformed payload");
			} catch ({ message }) {
				return ErrorPayload.send(
					{
						error: { message },
					},
					this
				);
			}

			try {
				for (const [name, payload] of Object.entries(config.bridge.payloads)) {
					if (data.name === name) {
						return payload.handle(data, this);
					}
				}
			} catch (err) {
				console.error(`${data.name} exception:`, err);
				console.log("with payload: ", data.data);
				return new Promise((_, reject) => reject(err.message));
			}

			console.log("Invalid payload:");
			console.log(data);
			return ErrorPayload.send(
				{
					error: { message: "Payload doesn't exist, nothing was done" },
				},
				this
			);
		});

		this.connection?.on("close", (code, desc) => {
			this.discord.destroy();
			console.log(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
		});

		console.log(`'${this.config.name}' Game Server connected`);
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

	async sendLua(code: string, realm: RconResponse["realm"] = "sv", runner = "Metaconcord") {
		if (!this.connection?.connected) return;
		return this.bridge.payloads["RconPayload"].callLua(code, realm, this, runner);
	}

	async sshExec(
		command: string,
		parameters: string[],
		options: (SSHExecOptions & { stream?: "stdout" | "stderr" | undefined }) | undefined
	) {
		if (!this.config.ssh) return;
		const ssh = new NodeSSH();
		try {
			const connection = await ssh.connect({
				username: this.config.ssh.username,
				host: this.config.ssh.host,
				port: this.config.ssh.port,
				privateKeyPath: sshConfig.keyPath,
			});
			return await connection.exec(command, parameters, options);
		} catch (err) {
			console.error(err);
		}
	}
}
