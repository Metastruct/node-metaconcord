import { Ajv, type ErrorObject } from "ajv";
import type { connection as WebSocketConnection } from "websocket";

import { logger } from "#lib/logger";
import type GameConnection from "./GameConnection.ts";

const log = logger(import.meta);

export type WsGameConnection = GameConnection & { wsConnection?: WebSocketConnection };

export default abstract class Payload {
	protected static requestSchema: Record<string, unknown>;
	protected static responseSchema: Record<string, unknown>;

	protected static getValidationResult(
		schema: Record<string, unknown>,
		payload: unknown
	): ([true, undefined] | [false, ErrorObject[] | undefined]) {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);

		return validate(payload)
			? [true, undefined]
			: [false, validate.errors ?? undefined];
	}

	static validate(schema: Record<string, unknown>, payload: unknown): void {
		if (!schema) return;
		const [validated, error] = this.getValidationResult(schema, payload);
		if (!validated) {
			log.warn({ error, payload }, "invalid payload.");
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
