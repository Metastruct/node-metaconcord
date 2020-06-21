import * as Ajv from "ajv";
import * as schema from "./requests/PayloadRequest.json";
import { PayloadRequest, PayloadResponse } from "./requests";
import { Server } from "../index";
import {
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";

export default abstract class Payload {
	protected schema = schema;
	protected connection: WebSocketConnection;
	protected gameBridge: Server;

	public constructor(connection: WebSocketConnection, server: Server) {
		this.connection = connection;
		this.gameBridge = server;
	}

	public isInvalid(payload: PayloadRequest): Ajv.ErrorObject[] {
		const ajv = new Ajv();
		const validate = ajv.compile(this.schema);
		if (!validate(payload)) {
			this.connection.sendPayload("ErrorPayload", {
				error: {
					message: "Invalid payload",
					validator: validate.errors,
				},
			});
			return validate.errors;
		}
	}

	public handle(request: WebSocketRequest, payload: PayloadRequest): void {
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

	public send(payload: PayloadResponse): void {
		this.connection.send(
			JSON.stringify({
				payload: {
					name,
					...payload,
				},
			})
		);
	}
}
