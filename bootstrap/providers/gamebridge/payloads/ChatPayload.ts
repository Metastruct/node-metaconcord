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

	public async handle(
		req: WebSocketRequest,
		payload: ChatRequest
	): Promise<void> {
		this.validate(this.requestSchema, payload);

		const ip = req.httpRequest.connection.remoteAddress;
		const webhook = new Webhook(
			this.bot.gameBridge.config.chatWebhookId,
			this.bot.gameBridge.config.chatWebhookToken
		);
		const server = this.bot.gameBridge.config.servers.filter(
			server => server.ip == ip
		)[0];

		let content = payload.message.content;
		content = content.replace(/@(\S*)/, (match, name) => {
			for (const [, member] of this.bot.client.channels.get(
				this.bot.gameBridge.config.relayChannelId
			).guild.members) {
				if (
					(member.nick &&
						member.nick.toLowerCase() == name.toLowerCase()) ||
					member.username.toLowerCase() == name.toLowerCase()
				)
					return `<@${member.id}>`;
			}
			return match;
		});
		const summary = await app.container
			.getService(Steam)
			.getUserSummaries(payload.message.player.steamId64);
		const avatar =
			summary && summary.avatar ? summary.avatar.large : undefined;
		webhook.send(
			content,
			`#${server.id} ${payload.message.player.name}`,
			avatar,
			[],
			{
				parse: ["users", "roles"],
			}
		);
	}
}
