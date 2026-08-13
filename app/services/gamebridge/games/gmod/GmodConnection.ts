import { request as WebSocketRequest } from "websocket";
import { NodeSSH, SSHExecOptions } from "node-ssh";
import { RconResponse } from "./handlers/structures/index.js";
import ErrorPayload from "./handlers/ErrorPayload.js";
import GameBridge from "../../GameBridge.js";
import GameConnection, { GameConnectionConfig } from "../../GameConnection.js";
import GameSocketConnection from "../../GameSocketConnection.js";
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

export default class GmodConnection extends GameSocketConnection {
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

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: GmodConnectionConfig;
	}) {
		super(config);
		this.config = config.serverConfig;
	}

	protected attachHandlers(): void {
		attachHandlers(this);
	}

	protected initialPresence(): void {
		this.setPresence("idle", { afk: true, state: "waiting for data" });
	}

	protected async postDisconnected(): Promise<void> {
		const { default: StatusPayload } = await import("./handlers/StatusPayload.js");
		await StatusPayload.handle({ name: "StatusPayload", data: {} }, this);
	}

	protected get ownServerList(): GameConnection[] {
		return this.bridge.servers.gmod;
	}

	protected onMalformedPayload(err: unknown): void {
		const message = err instanceof Error ? err.message : String(err);
		ErrorPayload.send({ error: { message } }, this);
	}

	protected onUnknownPayload(): void {
		ErrorPayload.send({ error: { message: "Payload doesn't exist, nothing was done" } }, this);
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
