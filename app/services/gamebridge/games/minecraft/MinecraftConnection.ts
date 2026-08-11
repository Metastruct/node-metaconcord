import {
	IUtf8Message,
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";
import { PayloadRequest } from "./handlers/structures/index.js";
import GameBridge from "../../GameBridge.js";
import GameConnection, { GameConnectionConfig } from "../../GameConnection.js";
import { attachHandlers } from "./handlers/index.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type MinecraftConnectionConfig = GameConnectionConfig & {
	ip?: string | string[];
	/** shown as the connect address on the status embed */
	address?: string;
};

export type MinecraftStatus = {
	hostname: string;
	version: string;
	maxPlayers: number;
	/** unix timestamp of server start */
	upSince: number;
};

export default class MinecraftConnection extends GameConnection {
	wsConnection?: WebSocketConnection;
	config: MinecraftConnectionConfig;
	lastStatus?: MinecraftStatus;

	private handlersAttached = false;

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: MinecraftConnectionConfig;
	}) {
		super({ bridge: config.bridge, serverConfig: config.serverConfig });
		this.config = config.serverConfig;
		this.wsConnection = config.req?.accept();

		this.discord.on("clientReady", async () => {
			this.setPresence("online");
			if (this.handlersAttached) return;
			this.handlersAttached = true;
			attachHandlers(this);
		});

		this.wsConnection?.on("message", async (msg: IUtf8Message) => {
			if (!msg || msg.utf8Data == "") return;

			let data: PayloadRequest;
			try {
				data = JSON.parse(msg.utf8Data) as PayloadRequest;
				if (!data.name || !data.data) throw new Error("Malformed payload");
			} catch (err) {
				log.warn({ err, raw: msg.utf8Data }, "malformed payload");
				return;
			}

			if (this.listenerCount(data.name) === 0) {
				log.info(data, "Invalid payload");
				return;
			}

			try {
				this.emit(data.name, data);
			} catch (err) {
				log.error({ data, err });
			}
		});

		this.wsConnection?.on("close", async (code, desc) => {
			this.disconnected = true;
			try {
				const { default: StatusPayload } = await import("./handlers/StatusPayload.js");
				await StatusPayload.postDisconnected(this);
			} catch (err) {
				log.error(err, "failed to post disconnect status");
			}
			this.discord.destroy();
			log.info(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
			if (this.bridge.servers[this.config.id] === this) {
				delete this.bridge.servers[this.config.id];
			}
		});

		log.info(`'${this.config.name}' Game Server connected`);
	}
}
