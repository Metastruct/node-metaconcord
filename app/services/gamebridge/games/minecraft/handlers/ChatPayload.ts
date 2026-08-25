import * as Discord from "discord.js";
import { ChatRequest, ChatResponse } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import { chatWebhook } from "../webhooks.js";
import { formatDiscordMessage } from "../../../discord/formatDiscordMessage.js";
import requestSchema from "./structures/ChatRequest.json" with { type: "json" };
import responseSchema from "./structures/ChatResponse.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

// images don't render ingame, so replace the raw URLs with a placeholder instead of dumping a link
function collapseImages(content: string, msg: Discord.Message | Discord.MessageSnapshot): string {
	for (const [, attachment] of msg.attachments) {
		const isImage =
			attachment.contentType?.startsWith("image/") ??
			/\.(png|jpe?g|gif|webp)$/i.test(attachment.name);
		if (isImage) content = content.replaceAll(attachment.url, `[${attachment.name}]`);
	}
	for (const [, sticker] of msg.stickers) {
		content = content.replaceAll(sticker.url, `[${sticker.name}]`);
	}
	return content;
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

			const mainMsg = await formatDiscordMessage(msg);
			mainMsg.content = collapseImages(mainMsg.content, msg);
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
						const referenceMessage = await formatDiscordMessage(snapshot);
						referenceMessage.content = collapseImages(
							referenceMessage.content,
							snapshot
						);

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
