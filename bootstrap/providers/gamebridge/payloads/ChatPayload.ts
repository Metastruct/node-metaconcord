import * as schema from "@/schemas/ChatPayloadRequest.json";
import { Payload, PayloadRequest } from ".";
import { SteamService } from "../../steam";
import { Webhook } from "discord-whook.js";
import app from "@/app";

interface ChatPayloadRequest extends PayloadRequest {
	name: "ChatPayload";
	message: {
		player: {
			name: string;
			steamId64: string;
		};
		content: string;
	};
}

export class ChatPayload extends Payload {
	protected schema = schema;

	public async handle(payload: ChatPayloadRequest): Promise<void> {
		super.handle(payload);

		const host = this.request.host;
		const config = this.gameBridge.config.servers.filter(
			server => server.host == host
		)[0];
		const webhook = new Webhook(
			config.discordWebhookId,
			config.discordWebhookToken
		);

		const steamUser = await app.container
			.getService(SteamService)
			.getUserSummaries(payload.message.player.steamId64);
		webhook.send(
			payload.message.content,
			`#${config.id} ${payload.message.player.name}`,
			steamUser.avatar.large
		);
	}
}
