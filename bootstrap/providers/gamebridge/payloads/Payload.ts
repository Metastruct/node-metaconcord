import * as Ajv from "ajv";
import * as requestSchema from "./structures/PayloadRequest.json";
import * as responseSchema from "./structures/PayloadResponse.json";
import { PayloadRequest, PayloadResponse } from "./structures";
import { Server } from "../index";
import {
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";

export default abstract class Payload {
	protected requestSchema = requestSchema;
	protected responseSchema = responseSchema;
	protected connection: WebSocketConnection;
	protected gameBridge: Server;

	public constructor(connection: WebSocketConnection, server: Server) {
		this.connection = connection;
		this.gameBridge = server;
	}

	public isInvalid(
		schema: any,
		payload: PayloadRequest | PayloadResponse
	): Ajv.ErrorObject[] {
		const ajv = new Ajv();
		const validate = ajv.compile(schema);
		if (!validate(payload)) {
			return validate.errors;
		}
	}

	public validate(schema: any, payload: PayloadResponse): void {
		const invalid = this.isInvalid(schema, payload);
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

	public async handle?(
		request: WebSocketRequest,
		payload: PayloadRequest
	): Promise<void>;

	public async send(payload: PayloadResponse): Promise<void> {
		this.connection.send(
			JSON.stringify({
				payload: {
					name: this.constructor.name,
					...payload,
				},
			})
		);
	}
}
