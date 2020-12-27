import "@/extensions/discord-whook";
import * as requestSchema from "./structures/ChatRequest.json";
import * as responseSchema from "./structures/ChatResponse.json";
import { ChatRequest } from "./structures";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import { Webhook } from "discord-whook.js";
import Payload from "./Payload";
import app from "@/app";

export default class ChatPayload extends Payload {
	protected requestSchema = requestSchema;
	protected responseSchema = responseSchema;

	async handle(req: WebSocketRequest, payload: ChatRequest): Promise<void> {
		this.validate(this.requestSchema, payload);
		const server = this.server;
		const bridge = this.server.bridge;
		const discordClient = this.server.discord.client;

		const webhook = new Webhook(bridge.config.chatWebhookId, bridge.config.chatWebhookToken);

		// Parse mentions
		let content = payload.message.content;
		content = content.replace(/@(\S*)/, (match, name) => {
			for (const [, member] of discordClient.channels.get(bridge.config.relayChannelId).guild
				.members) {
				if (
					member?.nick?.toLowerCase() == name.toLowerCase() ||
					member.username.toLowerCase() == name.toLowerCase()
				)
					return `<@${member.id}>`;
			}
			return match;
		});

		// Fetch Steam avatar
		const summary = await app.container
			.getService(Steam)
			.getUserSummaries(payload.message.player.steamId64);
		const avatar = summary?.avatar?.large ?? undefined;

		// Post the damn thing
		await webhook
			.send(content, `#${server.config.id} ${payload.message.player.name}`, avatar, [], {
				parse: ["users", "roles"],
			})
			.catch(console.error);
	}
}
