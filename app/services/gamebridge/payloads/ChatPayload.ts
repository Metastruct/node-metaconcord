import * as requestSchema from "./structures/ChatRequest.json";
import * as responseSchema from "./structures/ChatResponse.json";
import { ChatRequest, ChatResponse } from "./structures";
import { GameServer } from "..";
import Discord from "discord.js";
import Payload from "./Payload";
import config from "@/discord.json";

export default class ChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async handle(payload: ChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { player } = payload.data;
		let { content } = payload.data;
		const { bridge, discord: discordClient } = server;

		const guild = await discordClient.guilds.resolve(config.guildId)?.fetch();
		if (!guild) return;

		const webhook = new Discord.WebhookClient({
			id: bridge.config.chatWebhookId,
			token: bridge.config.chatWebhookToken,
		});

		const avatar = await bridge.container.getService("Steam").getUserAvatar(player.steamId64);

		const matches = content.match(/@(\S*)/g);
		const cachedMembers = new Discord.Collection<string, Discord.GuildMember>();

		if (matches) {
			for (const match of matches) {
				const name = match.substr(1);
				if (cachedMembers.has(name)) continue; // don't fetch if it's already cached
				const members = await guild.members.fetch({ query: name, limit: 1 });
				const foundMember = members.first();
				if (!foundMember) continue;

				cachedMembers.set(name, foundMember);
			}

			content = content.replace(/@(\S*)/g, (match, name) => {
				if (cachedMembers.has(name)) return `<@!${cachedMembers.get(name).id}>`;
				return match;
			});
		}

		const motd = bridge.container.getService("Motd");
		if (motd.isValidMsg(content)) {
			motd.pushMessage(content);
			bridge.container.getService("Markov").addLine(content);
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
