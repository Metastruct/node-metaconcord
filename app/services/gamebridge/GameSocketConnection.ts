import {
	IUtf8Message,
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";
import GameBridge from "./GameBridge.js";
import GameConnection, { GameConnectionConfig } from "./GameConnection.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

type WsPayload = { name: string; data: Record<string, unknown> };

/**
 * Shared plumbing for games transported over the addon's own websocket
 * (Gmod, Minecraft): message parse/dispatch, attaching payload handlers once
 * Discord is ready, and disconnect teardown. Game-specific bits (RCON, ssh,
 * gamemodes, ...) stay on the concrete subclasses.
 */
export default abstract class GameSocketConnection extends GameConnection {
	wsConnection?: WebSocketConnection;

	private handlersAttached = false;
	/**
	 * Payloads received before Discord is ready and handlers are attached. The
	 * bridges send their status right after connecting and only resend it on
	 * events, so dropping these leaves the status empty until the next event.
	 */
	private pendingPayloads: WsPayload[] = [];
	private static readonly MAX_PENDING = 100;

	constructor(config: {
		req?: WebSocketRequest;
		bridge: GameBridge;
		serverConfig: GameConnectionConfig;
	}) {
		super({ bridge: config.bridge, serverConfig: config.serverConfig });
		this.wsConnection = config.req?.accept();

		this.discord.on("clientReady", async () => {
			this.initialPresence();
			if (this.handlersAttached) return;
			this.handlersAttached = true;
			this.attachHandlers();

			const pending = this.pendingPayloads;
			this.pendingPayloads = [];
			for (const data of pending) this.dispatch(data);
		});

		this.wsConnection?.on("message", async (msg: IUtf8Message) => {
			if (!msg || msg.utf8Data == "") return;

			let data: WsPayload;
			try {
				data = JSON.parse(msg.utf8Data) as WsPayload;
				if (!data.name || !data.data) throw new Error("Malformed payload");
			} catch (err) {
				log.warn({ err, raw: msg.utf8Data }, "malformed payload");
				this.onMalformedPayload?.(err);
				return;
			}

			if (!this.handlersAttached) {
				if (this.pendingPayloads.length >= GameSocketConnection.MAX_PENDING) {
					this.pendingPayloads.shift();
				}
				this.pendingPayloads.push(data);
				return;
			}

			this.dispatch(data);
		});

		this.wsConnection?.on("close", async (code, desc) => {
			this.disconnected = true;
			try {
				await this.postDisconnected();
			} catch (err) {
				log.error(err, "failed to post disconnect status");
			}
			this.discord.destroy();
			log.info(`'${this.config.name}' Game Server disconnected - [${code}] ${desc}`);
			const ownServerList = this.ownServerList;
			if (ownServerList[this.config.id] === this) {
				delete ownServerList[this.config.id];
			}
		});

		log.info(`'${this.config.name}' Game Server connected`);
	}

	/** Attaches this game's payload handlers. Called once, the first time Discord becomes ready. */
	private dispatch(data: WsPayload): void {
		if (this.listenerCount(data.name) === 0) {
			log.info(data, "Invalid payload");
			this.onUnknownPayload?.(data);
			return;
		}

		try {
			this.emit(data.name, data);
		} catch (err) {
			log.error({ data, err });
		}
	}

	protected abstract attachHandlers(): void;

	/** Sets the bot's presence. Called every time Discord becomes ready. */
	protected abstract initialPresence(): void;

	/** Posts/edits the status message to reflect the disconnect, before the Discord client is destroyed. */
	protected abstract postDisconnected(): Promise<void>;

	/** This connection's own `bridge.servers.<game>` array, used to remove itself on disconnect. */
	protected abstract get ownServerList(): GameConnection[];

	/** Optional hook for games that reply to the addon over the socket on a malformed payload. */
	protected onMalformedPayload?(err: unknown): void;

	/** Optional hook for games that reply to the addon over the socket on an unrecognized payload name. */
	protected onUnknownPayload?(data: WsPayload): void;
}
