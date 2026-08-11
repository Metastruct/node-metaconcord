import { Ajv, type ErrorObject } from "ajv";
import { connection as WebSocketConnection } from "websocket";
import GameConnection from "./GameConnection.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type WsGameConnection = GameConnection & { wsConnection?: WebSocketConnection };

export default abstract class Payload {
	protected static requestSchema: Record<string, unknown>;
	protected static responseSchema: Record<string, unknown>;

	protected static isInvalid(
		schema: Record<string, unknown>,
		payload: unknown
	): ErrorObject[] | undefined {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);
		if (!validate(payload)) {
			return validate.errors ?? undefined;
		}
	}

	static validate(schema: Record<string, unknown>, payload: unknown): void {
		if (!schema) return;
		const invalid = this.isInvalid(schema, payload);
		if (invalid) {
			log.warn({ invalid, payload }, "invalid payload.");
		}
	}

	static async handle(
		payload: { name: string; data: unknown },
		_server?: unknown
	): Promise<void> {
		this.validate(this.requestSchema, payload);
	}

	static async initialize(_server?: unknown): Promise<void> {}

	static async send(payload: unknown, server: WsGameConnection): Promise<void> {
		this.validate(this.responseSchema, payload);

		if (server && server.wsConnection?.state === "open") {
			server.wsConnection.send(
				JSON.stringify({
					payload: {
						name: this.name,
						data: payload,
					},
				})
			);
		}
	}
}
