import { Ajv } from "ajv";
import { PayloadRequest } from "./structures/index.js";
import GameServer from "../GameServer.js";
import util from "util";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export default abstract class Payload {
	protected static requestSchema: Record<any, unknown>;
	protected static responseSchema: Record<any, unknown>;

	protected static isInvalid(
		schema: Record<string, unknown>,
		payload: PayloadRequest | unknown
	): any {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);
		if (!validate(payload)) {
			return validate.errors;
		}
	}

	static validate(schema: Record<string, unknown>, payload: PayloadRequest | unknown): void {
		const invalid = this.isInvalid(schema, payload);
		if (invalid) {
			log.warn({ invalid, payload }, "invalid payload.");
		}
	}

	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	static async handle(payload: PayloadRequest, server: GameServer): Promise<void> {
		this.validate(this.requestSchema, payload);
	}

	// eslint-disable-next-line @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars
	static async initialize(server: GameServer): Promise<void> {}

	static async send(payload: unknown, server: GameServer): Promise<void> {
		this.validate(this.responseSchema, payload);

		if (server && server.connection?.state === "open") {
			server.connection.send(
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
