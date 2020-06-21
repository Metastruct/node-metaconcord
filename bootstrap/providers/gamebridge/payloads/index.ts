import * as Ajv from "ajv";
import * as schema from "./requests/PayloadRequest.json";
import { GameBridgeServer } from "../index";
import { PayloadRequest } from "./requests/PayloadRequest";
import {
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";

export abstract class Payload {
	protected schema = schema;
	protected connection: WebSocketConnection;
	protected request: WebSocketRequest;
	protected gameBridge: GameBridgeServer;

	public constructor(
		connection: WebSocketConnection,
		request: WebSocketRequest,
		gameBridge: GameBridgeServer
	) {
		this.connection = connection;
		this.request = request;
		this.gameBridge = gameBridge;
	}

	public isInvalid(payload: PayloadRequest): Ajv.ErrorObject[] {
		const ajv = new Ajv();
		const validate = ajv.compile(this.schema);
		if (!validate(payload)) {
			this.connection.sendError(
				JSON.stringify({
					message: "Invalid payload",
					validator: validate.errors,
				})
			);
			return validate.errors;
		}
	}

	public handle(payload: PayloadRequest): void {
		const invalid = this.isInvalid(payload);
		if (invalid) {
			let msg = "";
			for (let i = 0; i < invalid.length; i++) {
				msg += `- ${invalid[i].message}${
					i == invalid.length - 1 ? "" : "\n"
				}`;
			}
			throw new Error(msg);
		}
	}

	public reply<T>(payload: T): void {
		payload = {
			name: this.constructor.name,
			...payload,
		};
		this.connection.send(
			JSON.stringify({
				payload,
			})
		);
	}
}

import { ChatPayload } from "./ChatPayload";

export const payloads = { ChatPayload };
