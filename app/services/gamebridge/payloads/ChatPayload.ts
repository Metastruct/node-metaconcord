import "@/extensions/discord-whook";
import * as requestSchema from "./structures/ChatRequest.json";
import * as responseSchema from "./structures/ChatResponse.json";
import { ChatRequest, ChatResponse } from "./structures";
import { GameServer } from "..";
import { Webhook } from "discord-whook.js";
import Payload from "./Payload";

export default class ChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async handle(payload: ChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { player } = payload.data;
		let { content } = payload.data;
		const {
			bridge,
			discord: { client: discordClient },
		} = server;

		const webhook = new Webhook(bridge.config.chatWebhookId, bridge.config.chatWebhookToken);

		const avatar = await bridge.container.getService("Steam").getUserAvatar(player.steamId64);
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
		await webhook
			.send(content, `#${server.config.id} ${player.nick}`, avatar, [], {
				parse: ["users", "roles"],
			})
			.catch(console.error);
	}

	static async send(payload: ChatResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
