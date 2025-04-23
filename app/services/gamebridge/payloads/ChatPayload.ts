import * as requestSchema from "./structures/ChatRequest.json";
import * as responseSchema from "./structures/ChatResponse.json";
import { ChatRequest, ChatResponse } from "./structures";
import { GameServer } from "..";
import Discord, { GuildMember, TextChannel } from "discord.js";
import Payload from "./Payload";

export default class ChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async initialize(server: GameServer): Promise<void> {
		const discord = server.discord;
		discord.on("messageCreate", async msg => {
			if (msg.channel.id != server.bridge.config.relayChannelId) return;
			if (msg.author.bot || !msg.author.client) return;

			if (msg.partial) {
				msg = await msg.fetch();
			}

			let content = msg.content;
			content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
				const extension = !!animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
			});
			content = content.replace(
				/<#([\d]+)>/g,
				(_, id) =>
					`#${
						msg.guild?.channels.cache.has(id)
							? (msg.guild.channels.cache.get(id) as TextChannel).name
							: "(uncached channel)"
					}`
			);
			content = content.replace(
				/<@!?(\d+)>/g,
				(_, id) =>
					`@${
						msg.guild?.members.cache.has(id)
							? (msg.guild.members.cache.get(id) as GuildMember).displayName
							: "(uncached user)"
					}`
			);
			content = content.replace(
				/(https?:\/\/tenor.com\/view\/\S+)/g,
				(_, url) => url + ".gif"
			);

			for (const [, attachment] of msg.attachments) {
				content += (content.length > 0 ? "\n" : "") + attachment.url;
			}
			for (const [, sticker] of msg.stickers) {
				content += (content.length > 0 ? "\n" : "") + sticker.url;
			}
			let reply: Discord.Message | undefined;
			if (msg.reference) {
    try {
					reply = await msg.fetchReference();
				} catch {}
			}

			const username = msg.author.username;
			let nickname = "";
			try {
				const author = await msg.guild?.members.fetch(msg.author.id);
				if (author && author.nickname && author.nickname.length > 0) {
					nickname = author.nickname;
				}
			} catch {} // dont care

			const avatarhash = msg.author.avatar;
			const avatar = avatarhash
				? `https://cdn.discordapp.com/avatars/${msg.author.id}/${avatarhash}${
						avatarhash.startsWith("a_") ? ".gif" : ".png"
				  }`
				: msg.author.defaultAvatarURL;

			const payload: ChatResponse = {
				user: {
					id: msg.author.id,
					username: username,
					nick: nickname,
					color: msg.member?.displayColor ?? 0,
					avatar_url: avatar,
				},
				msgID: msg.id,
				content: content,
			};

			if (reply) {
				payload.replied_message = {
					msgID: reply.id,
					content: reply.content,
					ingameName: reply.webhookId ? reply.author.username : "",
				};
			}

			this.send(payload, server);
		});
	}

	static async handle(payload: ChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);
		const { player } = payload.data;
		let { content } = payload.data;
		const { bridge, discord, discordWH } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const webhook = discordWH;

		const avatar = await (
			await bridge.container.getService("Steam")
		).getUserAvatar(player.steamId64);

		const matches = content.matchAll(/@(\S*)/g);

		if (matches) {
			for (const match of matches) {
				const name = match[1];
				const users = await guild.members.fetch({ query: name, limit: 1 });
				const user = users.first();
				if (user) {
					content = content.replaceAll(match[0], `<@${user.id}>`);
				}
			}
		}

		content = content.substring(0, 2000);

		const motd = await bridge.container.getService("Motd");
		if (motd.isValidMsg(content)) {
			motd.pushMessage(content);
			(await bridge.container.getService("Markov")).learn(content);
		}

		// 9312 = ①, 9313 = ②, and so on until 20
		const serverId = `#${server.config.id}`; // String.fromCodePoint(9311 + +(server.config.id ?? 0));
		await webhook
			?.send({
				content: content,
				username: `${serverId} ${player.nick
					// .replace(/@/g, "(at)")
					// .replace(/#/g, "")
					.substring(0, 77)
					.replaceAll("discord", "discоrd")
					.replaceAll("Discord", "Discоrd")}`,
				avatarURL: avatar,
				allowedMentions: { parse: ["users", "roles"] },
			})
			.catch(console.error);
	}

	static async send(payload: ChatResponse, server: GameServer): Promise<void> {
		super.send(payload, server);
	}
}
