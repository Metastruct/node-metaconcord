import { FluxerRest } from "./Rest.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);
const FATAL_CLOSE_CODES = new Set([4004, 4010, 4011, 4012]);

type GatewayPayload = {
	op: number;
	d?: unknown;
	s?: number;
	t?: string;
};

export class FluxerGateway {
	private socket?: WebSocket;
	private gatewayUrl?: string;
	private heartbeat?: NodeJS.Timeout;
	private reconnect?: NodeJS.Timeout;
	private sessionId?: string;
	private processedSequence: number | null = null;
	private dispatchQueue = Promise.resolve();
	private connecting = false;
	private awaitingHeartbeatAck = false;
	private heartbeatInterval = 0;
	private heartbeatSentAt = 0;
	private generation = 0;
	private resumeGeneration?: number;
	private readonly failedGenerations = new Set<number>();
	private reconnectAttempts = 0;

	constructor(
		private readonly rest: FluxerRest,
		private readonly token: string,
		private readonly guildId: string,
		private readonly onDispatch: (event: string, data: unknown) => Promise<void>
	) {}

	start() {
		void this.connect();
	}

	private async connect() {
		if (this.connecting || this.socket?.readyState === WebSocket.OPEN) return;
		this.connecting = true;
		try {
			if (!this.gatewayUrl) {
				const gateway = await this.rest.request<{ url: string }>("GET", "/gateway/bot");
				this.gatewayUrl = gateway.url;
			}
			const separator = this.gatewayUrl.includes("?") ? "&" : "?";
			const socket = new WebSocket(`${this.gatewayUrl}${separator}v=1&encoding=json`);
			const generation = ++this.generation;
			this.socket = socket;
			socket.addEventListener("message", event =>
				this.handleMessage(socket, generation, event)
			);
			socket.addEventListener("close", event => {
				if (generation !== this.generation) return;
				this.generation++;
				this.clearHeartbeat();
				if (this.socket === socket) this.socket = undefined;
				if (event.code === 4007 && this.resumeGeneration === generation) {
					this.sessionId = undefined;
					this.processedSequence = null;
				}
				if (this.resumeGeneration === generation) this.resumeGeneration = undefined;
				if (FATAL_CLOSE_CODES.has(event.code)) {
					log.error(
						{ code: event.code, reason: event.reason },
						"Fluxer gateway stopped after fatal close"
					);
					return;
				}
				log.warn({ code: event.code, reason: event.reason }, "Fluxer gateway disconnected");
				this.scheduleReconnect();
			});
			socket.addEventListener("error", event => {
				log.error({ event }, "Fluxer gateway error");
			});
		} catch (error) {
			log.error({ err: error }, "Fluxer gateway connection failed");
			this.scheduleReconnect();
		} finally {
			this.connecting = false;
		}
	}

	private handleMessage(socket: WebSocket, generation: number, event: MessageEvent) {
		if (generation !== this.generation) return;
		let payload: GatewayPayload;
		try {
			payload = JSON.parse(String(event.data)) as GatewayPayload;
		} catch (error) {
			log.error({ err: error }, "Invalid Fluxer gateway payload");
			return;
		}
		if (payload.op === 10) {
			const interval = (payload.d as { heartbeat_interval: number }).heartbeat_interval;
			this.heartbeatInterval = interval;
			this.clearHeartbeat();
			this.heartbeat = setInterval(() => this.sendHeartbeat(socket, generation), interval);
			if (this.sessionId) {
				this.resumeGeneration = generation;
				this.send(socket, 6, {
					token: this.token,
					session_id: this.sessionId,
					seq: this.processedSequence ?? 0,
				});
			} else {
				this.identify(socket);
			}
			return;
		}
		if (payload.op === 11) {
			this.awaitingHeartbeatAck = false;
			return;
		}
		if (payload.op === 1) {
			this.sendHeartbeat(socket, generation, true);
			return;
		}
		if (payload.op === 7) {
			socket.close(4000, "Reconnect requested");
			return;
		}
		if (payload.op === 9) {
			this.dispatchQueue = this.dispatchQueue.then(() => {
				if (generation !== this.generation) return;
				this.failedGenerations.add(generation);
				this.sessionId = undefined;
				this.processedSequence = null;
				this.resumeGeneration = undefined;
				socket.close(4007, "Invalid session");
			});
			return;
		}
		if (payload.op !== 0 || !payload.t || payload.s == null) return;
		if (payload.t === "READY") {
			this.sessionId = (payload.d as { session_id: string }).session_id;
			log.info("Fluxer gateway ready");
		} else if (payload.t === "RESUMED") {
			log.info("Fluxer gateway resumed");
		}
		this.dispatchQueue = this.dispatchQueue.then(async () => {
			if (generation !== this.generation || this.failedGenerations.has(generation)) return;
			try {
				await this.onDispatch(payload.t!, payload.d);
				if (generation === this.generation && !this.failedGenerations.has(generation)) {
					this.processedSequence = payload.s!;
					if (payload.t === "READY" || payload.t === "RESUMED") {
						this.reconnectAttempts = 0;
						this.resumeGeneration = undefined;
					}
				}
			} catch (error) {
				log.error({ err: error, event: payload.t }, "Fluxer dispatch failed");
				if (generation === this.generation) {
					this.failedGenerations.add(generation);
					socket.close(4000, "Dispatch failed");
				}
			}
		});
	}

	private identify(socket: WebSocket) {
		this.send(socket, 2, {
			token: this.token,
			properties: {
				os: process.platform,
				browser: "Metaconcord",
				device: "Metaconcord Bridge",
			},
			initial_guild_id: this.guildId,
		});
	}

	private sendHeartbeat(socket: WebSocket, generation: number, requested = false) {
		if (generation !== this.generation || socket.readyState !== WebSocket.OPEN) return;
		if (this.awaitingHeartbeatAck) {
			if (Date.now() - this.heartbeatSentAt >= this.heartbeatInterval) {
				log.warn("Fluxer heartbeat was not acknowledged; reconnecting");
				socket.close(4000, "Heartbeat timeout");
			}
			if (!requested) return;
		} else {
			this.awaitingHeartbeatAck = true;
			this.heartbeatSentAt = Date.now();
		}
		this.send(socket, 1, this.processedSequence);
	}

	private send(socket: WebSocket, op: number, data: unknown) {
		if (socket.readyState !== WebSocket.OPEN) return;
		socket.send(JSON.stringify({ op, d: data }));
	}

	private scheduleReconnect() {
		if (this.reconnect) return;
		const delay = Math.min(60_000, 1000 * 2 ** this.reconnectAttempts++) + Math.random() * 500;
		this.reconnect = setTimeout(() => {
			this.reconnect = undefined;
			void this.connect();
		}, delay);
	}

	private clearHeartbeat() {
		if (this.heartbeat) clearInterval(this.heartbeat);
		this.heartbeat = undefined;
		this.awaitingHeartbeatAck = false;
		this.heartbeatSentAt = 0;
	}
}
