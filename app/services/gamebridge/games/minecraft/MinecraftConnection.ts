import { request as WebSocketRequest } from "websocket";
import GameBridge from "../../GameBridge.js";
import GameConnection, { GameConnectionConfig } from "../../GameConnection.js";
import GameSocketConnection from "../../GameSocketConnection.js";
import { attachHandlers } from "./handlers/index.js";

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

export default class MinecraftConnection extends GameSocketConnection {
	config: MinecraftConnectionConfig;
	lastStatus?: MinecraftStatus;
	/** average ms per tick from the latest StatsPayload */
	lastMspt?: number;

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: MinecraftConnectionConfig;
	}) {
		super(config);
		this.config = config.serverConfig;
	}

	protected attachHandlers(): void {
		attachHandlers(this);
	}

	protected initialPresence(): void {
		this.setPresence("online");
	}

	protected async postDisconnected(): Promise<void> {
		const { default: StatusPayload } = await import("./handlers/StatusPayload.js");
		await StatusPayload.postDisconnected(this);
	}

	protected get ownServerList(): GameConnection[] {
		return this.bridge.servers.minecraft;
	}
}
