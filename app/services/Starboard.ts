import * as Discord from "discord.js";

import { logger } from "#utils";
import { type Container, Service } from "../Container.js";
import { type DiscordBot, type LocalDB } from "./index.js";

import discordConfig from "#config/discord.json" with { type: "json" };
import config from "#config/starboard.json" with { type: "json" };

const log = logger(import.meta);

const STARBOARD_CONFIG = {
	MESSAGE_AGE_LIMIT_MS: 3 * 28 * 24 * 60 * 60 * 1000, // 3 months
	DEFAULT_AMOUNT: config.amount,
	DEFAULT_EMOTE: config.defaultEmote,
} as const;

const filterStarboardId = (btn: Discord.MessageComponentInteraction) =>
	btn.customId.startsWith("starboard");

export class Starboard extends Service {
	override name = "Starboard";
	private pendingMessages = new Set<string>();
	private localDB!: LocalDB;
	private bot!: DiscordBot;

	override async init(): Promise<void> {
		this.localDB = this.container.getService("LocalDB");
		this.bot = this.container.getService("DiscordBot");

		this.bot.discord.on("interactionCreate", async interaction => {
			if (!interaction.isButton()) return;
			if (!filterStarboardId(interaction)) return;
			if (interaction.message.author.username !== interaction.user.username) return;

			const [, originalMsgID, originalChannelID, originalAuthorID] =
				interaction.customId.split(":", 4);

			if (originalAuthorID && originalAuthorID !== interaction.user.id) return;

			try {
				const res = await interaction.message.delete().catch(log.error.bind(log));
				if (res) {
					this.bot
						.getTextChannel(this.bot.config.channels.log)
						?.send(
							`Highlighted Message in ${interaction.channel} deleted by ${interaction.user} (${interaction.user.id}) -> https://discord.com/channels/${interaction.guildId}/${originalChannelID}/${originalMsgID}`
						);
				}
			} catch (error) {
				log.error(error, "failed to delete message");
			}
		});
	}

	async isMsgStarred(msgId: string): Promise<boolean> {
		const res = await this.localDB.db.selectNoFrom(
			eb => eb.exists(
				eb => eb.selectFrom("starboard").selectAll().where("MessageId", "=", msgId)
			).as("exists")
		).limit(1).executeTakeFirst();
		return Boolean(res?.exists);
	}

	private async starMsg(msgId: string): Promise<void> {
		const db = this.localDB.getLocalDatabase();
		db.prepare("INSERT OR IGNORE INTO starboard(MessageId) VALUES(?)").run(msgId);
	}

	public async handleReactionAdded(reaction: Discord.MessageReaction): Promise<void> {
		try {
			const message = reaction.message;

			const channel = message.channel as Discord.GuildChannel;
			const client = reaction.client;
			const emoji = reaction.emoji;
			const parent = channel.parentId;

			if (config.channelIgnores.includes(channel.id)) return;
			if (parent && config.categoryIgnores.includes(parent)) return;
			if (this.pendingMessages.has(message.id)) return;
			this.pendingMessages.add(message.id);

			let needed: number = STARBOARD_CONFIG.DEFAULT_AMOUNT;
			let emojiFilter: Set<string> = new Set([STARBOARD_CONFIG.DEFAULT_EMOTE]);
			let targetChannel: Discord.Channel | undefined = client.channels.cache.get(
				discordConfig.channels.h
			);
			let title: string | undefined;
			let shouldReact = false;
			let countAllUsers = false;

			if (emoji.name !== STARBOARD_CONFIG.DEFAULT_EMOTE) {
				switch (parent) {
					// the parent of a thread is the main channel, so we sadly can't get the category without fetching, so much for dry
					case discordConfig.channels.postYourStuff:
						emojiFilter = new Set();
						shouldReact = true;
						needed = 6;
						countAllUsers = true;
						title =
							message.channel.isThread() && message.id === message.channel.id
								? message.channel.name
								: undefined;
						targetChannel = client.channels.cache.get(discordConfig.channels.hArt);
						break;
					default:
						switch (channel.id) {
							case discordConfig.channels.artChat:
								emojiFilter = new Set();
								shouldReact = true;
								needed = 6;
								countAllUsers = true;
								targetChannel = client.channels.cache.get(
									discordConfig.channels.hArt
								);
								break;
						}
				}
			}

			let count: number;
			// sadly we cannot just count them all up, because only one per user is allowed
			if (countAllUsers) {
				const allUsers = new Set<string>();
				for (const [, r] of message.reactions.cache) {
					const fetchedUsers = await r.users.fetch();
					for (const user of fetchedUsers.values()) {
						allUsers.add(user.id);
					}
				}
				if (message.author) allUsers.delete(message.author.id);
				count = allUsers.size;
			} else {
				const users = await reaction.users.fetch();
				const ego = users.has(message.author.id);
				count = ego ? reaction.count - 1 : reaction.count;
			}

			if (
				count >= needed &&
				(emojiFilter.size === 0 || emojiFilter.has(emoji.name ?? "")) &&
				!message.reactions.cache.some(
					e =>
						e.emoji.name === "⛔" &&
						message.author &&
						e.users.cache.has(message.author.id)
				)
			) {
				const msg = await message.fetch();
				if (!msg) {
					log.error(reaction, "fetch message failed.");
					return;
				}

				if (msg.author.bot)
					targetChannel = client.channels.cache.get(discordConfig.channels.hBot);

				if (!targetChannel) {
					log.error(reaction, "invalid channel?");
					return;
				}

				// check against our local db first
				if (await this.isMsgStarred(msg.id)) {
					return;
				}

				// skip messages older than 3 months
				if (Date.now() - msg.createdTimestamp > STARBOARD_CONFIG.MESSAGE_AGE_LIMIT_MS) {
					return;
				}

				let text = title ? `## ${title}\n` : "";
				const files: string[] = [];

				const reference = msg.reference;
				if (reference && reference.messageId) {
					if (reference.type === 0) {
						const refMsg = await (
							client.channels.cache.get(reference.channelId) as Discord.TextChannel
						).messages.fetch(reference.messageId);

						text += `-# [replying to ${
							refMsg.system ? "System Message" : refMsg.author.username
						}](${refMsg.url})\n`;
					} else if (reference.type === 1) {
						const snap = msg.messageSnapshots.first();
						text += `-# [forwarded message]\n${snap?.content}`;
						snap?.attachments.forEach(a => void files.push(a.url));
					}
				}

				text += msg.content;
				text += msg.stickers.size > 0 ? msg.stickers.first()?.url : "";

				msg.attachments.forEach(a => void files.push(a.url));

				const channel = targetChannel as Discord.TextChannel;

				// we need a webhook created by the application so we can attach components
				const webhooks = await channel.fetchWebhooks();
				let webhook = webhooks.find(
					h => h.applicationId === discordConfig.bot.applicationId && h.token
				);
				if (!webhook)
					webhook = await channel.createWebhook({ name: "metaconcord starboard" });

				if (webhook) {
					const components: Discord.ActionRowBuilder<Discord.ButtonBuilder>[] = [
						new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
							new Discord.ButtonBuilder()
								.setLabel("Jump to message")
								.setStyle(Discord.ButtonStyle.Link)
								.setURL(msg.url),
							...(msg.author.bot
								? []
								: [
									new Discord.ButtonBuilder()
										.setLabel("Delete")
										.setStyle(Discord.ButtonStyle.Danger)
										.setCustomId(
											`starboard:${msg.id}:${msg.channelId}:${msg.author.id}`
										),
								])
						),
					];

					const starred = await webhook
						.send({
							content: text,
							avatarURL: msg.author.avatarURL() ?? "",
							username: msg.author.username,
							allowedMentions: { parse: ["users", "roles"] },
							files,
							components,
						})
						.catch(() => {});
					if (starred) {
						await this.starMsg(msg.id);
						if (shouldReact) await starred.react(emoji);
					}
				}
			}
		} catch (error) {
			log.error(error);
		} finally {
			this.pendingMessages.delete(reaction.message.id);
		}
	}
}

export default function StarboardProvider(container: Container): Service {
	return new Starboard(container);
}
