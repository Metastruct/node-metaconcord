import { DiscordClient, GameBridge } from ".";
import { ErrorPayload } from "./payloads";
import {
	IUtf8Message,
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";

export type GameServerConfig = {
	id: number;
	ip: string;
	name: string;
	label?: string;
	discordToken: string;
};

export type Player = {
	accountId: number;
	nick: string;
	avatar?: string | false;
	isAdmin: boolean;
	isBanned: boolean;
	isAfk?: boolean;
};

export default class GameServer {
	connection: WebSocketConnection;
	config: GameServerConfig;
	bridge: GameBridge;
	discord: DiscordClient;
	status: {
		mapThumbnail: string;
		players: Player[];
	} = { mapThumbnail: "", players: [] };
	playerListImage: Buffer;

	constructor(req: WebSocketRequest, bridge: GameBridge, config: GameServerConfig) {
		this.connection = req.accept();
		this.config = config;
		this.bridge = bridge;
		this.discord = new DiscordClient(this, {
			intents: ["Guilds", "GuildMessages"],
		});

		this.discord.run(this.config.discordToken);

		this.discord.on("ready", async () => {
			for (const [, payload] of Object.entries(bridge.payloads)) {
				payload.initialize(this);
			}
		});

		this.connection.on("message", async (msg: IUtf8Message) => {
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
				for (const [name, payload] of Object.entries(bridge.payloads)) {
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

		this.connection.on("close", (code, desc) => {
			this.discord.destroy();
			console.log(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
		});

		console.log(`'${this.config.name}' Game Server connected`);
	}
}
