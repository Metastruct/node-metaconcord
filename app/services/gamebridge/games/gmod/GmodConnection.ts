import {
	IUtf8Message,
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";
import { NodeSSH, SSHExecOptions } from "node-ssh";
import { PayloadRequest, RconResponse } from "./handlers/structures/index.js";
import ErrorPayload from "./handlers/ErrorPayload.js";
import GameBridge from "../../GameBridge.js";
import GameConnection, { GameConnectionConfig } from "../../GameConnection.js";
import RconPayload from "./handlers/RconPayload.js";
import { attachHandlers } from "./handlers/index.js";
import sshConfig from "@/config/ssh.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type GmodConnectionConfig = GameConnectionConfig & {
	defaultGamemode?: string;
	ip?: string | string[];
	ssh?: {
		host: string;
		port: number;
		username: string;
	};
};

export default class GmodConnection extends GameConnection {
	wsConnection?: WebSocketConnection;
	config: GmodConnectionConfig;
	defcon: number;
	gamemode: {
		folderName: string;
		name: string;
	};
	gamemodes: string[];
	serverUptime: number;
	mapUptime: number;
	workshopMap?: {
		name: string;
		id: string;
	};

	private handlersAttached = false;

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: GmodConnectionConfig;
	}) {
		super({ bridge: config.bridge, serverConfig: config.serverConfig });
		this.config = config.serverConfig;
		this.wsConnection = config.req?.accept();

		this.discord.on("clientReady", async () => {
			this.setPresence("idle", { afk: true, state: "waiting for data" });
			if (this.handlersAttached) return;
			this.handlersAttached = true;
			attachHandlers(this);
		});

		this.wsConnection?.on("message", async (msg: IUtf8Message) => {
			// if (received.utf8Data == "") console.log("Heartbeat");
			if (!msg || msg.utf8Data == "") return;

			let data: PayloadRequest;
			try {
				data = JSON.parse(msg.utf8Data) as PayloadRequest;
				if (!data.name || !data.data) throw new Error("Malformed payload");
			} catch ({ message }) {
				return ErrorPayload.send(
					{
						error: { message },
					},
					this
				);
			}

			if (this.listenerCount(data.name) === 0) {
				log.info(data, "Invalid payload");
				return ErrorPayload.send(
					{
						error: { message: "Payload doesn't exist, nothing was done" },
					},
					this
				);
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
				this.emit("StatusPayload", { name: "StatusPayload", data: {} });
			} catch (e) {
				log.error(e, "failed to send disconnect status");
			}
			this.discord.destroy();
			log.info(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
			if (this.bridge.servers[this.config.id] === this) {
				delete this.bridge.servers[this.config.id];
			}
		});

		log.info(`'${this.config.name}' Game Server connected`);
	}

	async sendLua(code: string, realm: RconResponse["realm"] = "sv", runner = "Metaconcord") {
		if (!this.wsConnection?.connected) return;
		return RconPayload.callLua(code, realm, this, runner);
	}

	async sendRcon(command: string, runner = "Metaconcord") {
		if (!this.wsConnection?.connected) return;
		return RconPayload.send({ isLua: false, command, runner }, this);
	}

	async sshExecCommand(command: string, options: SSHExecOptions | undefined) {
		if (!this.config.ssh) return;
		const ssh = new NodeSSH();
		try {
			const connection = await ssh.connect({
				username: this.config.ssh.username,
				host: this.config.ssh.host,
				port: this.config.ssh.port,
				privateKeyPath: sshConfig.keyPath,
			});
			return connection.execCommand(command, options);
		} catch (err) {
			log.error({ err, command, options }, "sshExecCommand failed.");
			throw err;
		}
	}
}
