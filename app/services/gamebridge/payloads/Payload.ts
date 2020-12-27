import * as requestSchema from "./structures/PayloadRequest.json";
import * as responseSchema from "./structures/PayloadResponse.json";
import { PayloadRequest, PayloadResponse } from "./structures";
import { request as WebSocketRequest } from "websocket";
import Ajv from "ajv";
import GameServer from "../GameServer";

export default abstract class Payload {
	protected requestSchema = requestSchema;
	protected responseSchema = responseSchema;
	protected server: GameServer;

	constructor(server: GameServer) {
		this.server = server;
	}

	isInvalid(
		schema: Record<string, unknown>,
		payload: PayloadRequest | PayloadResponse
	): Ajv.ErrorObject[] {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);
		if (!validate(payload)) {
			return validate.errors;
		}
	}

	validate(schema: Record<string, unknown>, payload: PayloadResponse): void {
		const invalid = this.isInvalid(schema, payload);
		if (invalid) {
			console.log(payload);
			let msg = "";
			for (let i = 0; i < invalid.length; i++) {
				msg += `${invalid[i].dataPath} ${invalid[i].message}${
					i == invalid.length - 1 ? "" : "\n"
				}`;
			}
			throw new Error(msg);
		}
	}

	async handle?(request: WebSocketRequest, payload: PayloadRequest): Promise<void>;

	async send(payload: PayloadResponse): Promise<void> {
		this.server.connection.send(
			JSON.stringify({
				payload: {
					name: this.constructor.name,
					...payload,
				},
			})
		);
	}
}
