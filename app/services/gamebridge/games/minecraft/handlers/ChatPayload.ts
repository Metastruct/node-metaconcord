import * as Discord from "discord.js";
import { ChatRequest, ChatResponse } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import { chatWebhook } from "../webhooks.js";
import requestSchema from "./structures/ChatRequest.json" with { type: "json" };
import responseSchema from "./structures/ChatResponse.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

const IMAGE_EXTENSION = /\.(png|jpe?g|gif|webp)$/i;
const IMAGE_URL = /https?:\/\/\S+/g;

// strip a URL's query string/fragment before checking its extension, since attachment
// and CDN links carry a signed query string (?ex=...&is=...&hm=...) that would otherwise
// always land after the extension and break a simple $-anchored match
function collapseImageUrl(url: string): string {
	const path = url.split(/[?#]/)[0];
	return IMAGE_EXTENSION.test(path) ? `[${path.split("/").pop()}]` : url;
}

// minecraft has no image rendering at all, so this mirrors formatDiscordMessage but
// collapses attachments/stickers/embeds/pasted links into a [filename] placeholder
// instead of leaking raw (and often broken-looking) URLs into ingame chat
async function formatForMinecraft(msg: Discord.Message | Discord.MessageSnapshot): Promise<{
	content: string;
	username?: string;
	nickname: string;
	avatar?: string;
	color: number;
}> {
	let content = msg.content;

	content = content.replace(/<a?:([^\s:<>]*):(\d+)>/g, (_, name) => `:${name}:`);
	content = content.replace(
		/<#(\d+)>/g,
		(_, id) => `#${msg.guild?.channels.cache.get(id)?.name ?? "(uncached channel)"}`
	);
	content = content.replace(
		/<@!?(\d+)>/g,
		(_, id) => `@${msg.guild?.members.cache.get(id)?.displayName ?? "(uncached user)"}`
	);
	content = content.replace(
		/https?:\/\/tenor\.com\/view\/\S+/g,
		url => `[${url.split("/").pop()}.gif]`
	);

	for (const [, attachment] of msg.attachments) {
		const isImage =
			attachment.contentType?.startsWith("image/") ?? IMAGE_EXTENSION.test(attachment.name);
		content +=
			(content.length > 0 ? "\n" : "") + (isImage ? `[${attachment.name}]` : attachment.url);
	}
	for (const [, sticker] of msg.stickers) {
		content += (content.length > 0 ? "\n" : "") + `[${sticker.name}]`;
	}

	content = content.replace(IMAGE_URL, collapseImageUrl);

	if (content.length === 0) {
		content =
			msg.embeds.length > 0
				? msg.embeds.some(e => e.image ?? e.thumbnail)
					? "[image.png]"
					: "[Embed]"
				: "[Something]";
	}

	const username = msg.author?.username;
	let nickname = "";
	let avatar: string | undefined = undefined;
	const color = msg.member?.displayColor ?? 0;

	if (msg.author) {
		try {
			const author = await msg.guild?.members.fetch(msg.author.id);
			if (author?.nickname) nickname = author.nickname;
		} catch {}

		const avatarhash = msg.author.avatar;
		avatar = avatarhash
			? `https://cdn.discordapp.com/avatars/${msg.author.id}/${avatarhash}${
					avatarhash.startsWith("a_") ? ".gif" : ".png"
				}`
			: msg.author.defaultAvatarURL;
	}

	return { content, username, nickname, avatar, color };
}

export default class ChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async initialize(server: MinecraftConnection): Promise<void> {
		const discord = server.discord;
		discord.on("messageCreate", async msg => {
			if (msg.channel.id != server.discord.config.channels.minecraftRelay) return;
			if (msg.author.bot || !msg.author.client) return;

			if (msg.partial) {
				msg = await msg.fetch();
			}

			const mainMsg = await formatForMinecraft(msg);
			let reply: Discord.Message | undefined;
			if (msg.reference) {
				try {
					if (msg.reference.type == 0) {
						reply = await msg.fetchReference();
					} else if (msg.reference.type == 1) {
						reply = undefined;
						const newContent = mainMsg.content;
						const snapshot = msg.messageSnapshots.first();
						if (!snapshot) return;
						const referenceMessage = await formatForMinecraft(snapshot);

						mainMsg.content = `-> Forwarded\n${referenceMessage.content}\n${newContent}`;
					}
				} catch {}
			}

			const payload: ChatResponse = {
				user: {
					id: msg.author.id,
					username: mainMsg.username ?? "wtf",
					nick: mainMsg.nickname,
					color: mainMsg.color,
					avatar_url: mainMsg.avatar ?? "https://cdn.discordapp.com/embed/avatars/0.png",
				},
				msgID: msg.id,
				content: mainMsg.content,
			};

			if (reply) {
				payload.replied_message = {
					msgID: reply.id,
					content: reply.content,
					ingameName: reply.webhookId ? reply.author.username : "",
				};
			}

			await this.send(payload, server);
		});
	}

	static async handle(payload: ChatRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);
		const { player, emote } = payload.data;
		let { content } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const avatar = `https://mc-heads.net/avatar/${player.uuid}`;

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

		// the webhook already shows the name, so an italic body reads as "Nick waves"
		content = emote ? `*${content.substring(0, 1998)}*` : content.substring(0, 2000);

		await chatWebhook
			.send({
				content: content,
				username: player.nick
					.substring(0, 77)
					.replaceAll("discord", "discоrd")
					.replaceAll("Discord", "Discоrd"),
				avatarURL: avatar,
				allowedMentions: { parse: ["users", "roles"] },
			})
			.catch(log.error.bind(log));
	}

	static async send(payload: ChatResponse, server: MinecraftConnection): Promise<void> {
		super.send(payload, server);
	}
}
