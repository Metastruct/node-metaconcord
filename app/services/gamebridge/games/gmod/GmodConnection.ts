import { request as WebSocketRequest } from "websocket";
import { RconResponse } from "./handlers/structures/index.js";
import ErrorPayload from "./handlers/ErrorPayload.js";
import GservPayload, { GservResult } from "./handlers/GservPayload.js";
import GameBridge from "../../GameBridge.js";
import GameConnection, { GameConnectionConfig } from "../../GameConnection.js";
import GameSocketConnection from "../../GameSocketConnection.js";
import RconPayload from "./handlers/RconPayload.js";
import { attachHandlers } from "./handlers/index.js";

export type GmodConnectionConfig = GameConnectionConfig & {
	defaultGamemode?: string;
	ip?: string | string[];
	/** public connect address and port, exposed to the website */
	address?: string;
	port?: number;
};

export default class GmodConnection extends GameSocketConnection {
	config: GmodConnectionConfig;
	defcon: number;
	gamemode: {
		folderName: string;
		name: string;
	};
	gamemodes: string[];
	hostname?: string;
	/** from the last StatsPayload, which is where game.MaxPlayers() arrives */
	maxPlayers?: number;
	serverUptime: number;
	/** epoch ms the server booted, derived from serverUptime when it was received */
	serverUpSince?: number;
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

	/**
	 * Runs a gserv verb on the game host through the addon's native module.
	 * Never rejects: a refused verb, a server with no native module, a
	 * disconnected server or a timeout all come back in the result.
	 */
	async runGserv(command: string, onChunk?: (chunk: string) => void): Promise<GservResult> {
		return GservPayload.run(command, this, onChunk);
	}
}
