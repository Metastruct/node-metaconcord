import "@/extensions/discord-whook";
import * as schema from "./requests/ChatRequest.json";
import { ChatRequest } from "./requests";
import { Steam } from "../../steam";
import {
	connection as WebSocketConnection,
	request as WebSocketRequest,
} from "websocket";
import { Webhook } from "discord-whook.js";

import Payload from "./Payload";
import app from "@/app";

export default class ChatPayload extends Payload {
	protected schema = schema;

	public async handle(
		req: WebSocketRequest,
		payload: ChatRequest
	): Promise<void> {
		super.handle(req, payload);

		const ip = req.httpRequest.connection.remoteAddress;
		const config = this.gameBridge.config;
		const webhook = new Webhook(
			config.chatWebhookId,
			config.chatWebhookToken
		);
		const server = this.gameBridge.config.servers.filter(
			server => server.ip == ip
		)[0];

		const steamUser = await app.container
			.getService(Steam)
			.getUserSummaries(payload.message.player.steamId64);
		webhook.send(
			payload.message.content,
			`#${server.id} ${payload.message.player.name}`,
			steamUser.avatar.large,
			[],
			{
				parse: ["users", "roles"],
			}
		);
	}

	/*
	public async send(
		connection: WebSocketConnection,
		payload: ChatPayloadResponse
	): Promise<void> {}
	*/
}
