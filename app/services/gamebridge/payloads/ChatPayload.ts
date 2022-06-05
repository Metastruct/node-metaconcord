import * as requestSchema from "./structures/ChatRequest.json";
import * as responseSchema from "./structures/ChatResponse.json";
import { ChatRequest, ChatResponse } from "./structures";
import { GameServer } from "..";
import Discord from "discord.js";
import Payload from "./Payload";

export default class ChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async handle(payload: ChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { player } = payload.data;
		let { content } = payload.data;
		const { bridge, discord } = server;

		if (!discord.isReady()) return;

		const guild = discord.guilds.cache.get(discord.config.guildId);
		if (!guild) return;

		const webhook = new Discord.WebhookClient({
			id: bridge.config.chatWebhookId,
			token: bridge.config.chatWebhookToken,
		});

		const avatar = await bridge.container.getService("Steam")?.getUserAvatar(player.steamId64);

		const matches = content.matchAll(/@(\S*)/g);

		if (matches) {
			for (const match of matches) {
				const name = match[1];
				const users = await guild.members.fetch({ query: name, limit: 1 });
				const user = users.first();
				if (user) {
					content = content.replace(match[0], `<@${user.id}>`);
				}
			}
		}

		content = content.substring(0, 2000);

		const motd = bridge.container.getService("Motd");
		if (motd?.isValidMsg(content)) {
			motd.pushMessage(content);
			bridge.container
				.getService("Markov")
				?.learn({ authorName: payload.data.player.nick, message: content });
		}

		await webhook
			.send({
				content: content,
				username: `#${server.config.id} ${player.nick}`,
				avatarURL: avatar,
				allowedMentions: { parse: ["users", "roles"] },
			})
			.catch(console.error);
	}

	static async send(payload: ChatResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
