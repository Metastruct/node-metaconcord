import "@/extensions/discord-whook";
import * as schema from "./requests/ChatPayloadRequest.json";
import { ChatPayloadRequest } from "./requests/ChatPayloadRequest";
import { Payload } from ".";
import { SteamService } from "../../steam";
import { Webhook } from "discord-whook.js";
import app from "@/app";

export class ChatPayload extends Payload {
	protected schema = schema;

	public async handle(payload: ChatPayloadRequest): Promise<void> {
		super.handle(payload);

		const ip = this.request.httpRequest.connection.remoteAddress;
		const config = this.gameBridge.config;
		const webhook = new Webhook(
			config.chatWebhookId,
			config.chatWebhookToken
		);
		const server = this.gameBridge.config.servers.filter(
			server => server.ip == ip
		)[0];

		const steamUser = await app.container
			.getService(SteamService)
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
}
