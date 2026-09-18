import * as Discord from "discord.js";
import { randomBytes } from "node:crypto";
import { Container, Service } from "@/app/Container.js";
import type { DiscordBot } from "@/app/services/discord/index.js";
import type { SQL } from "@/app/services/SQL.js";
import config from "@/config/fluxer.json" with { type: "json" };
import mappingSeed from "./mappings.json" with { type: "json" };
import { logger } from "@/utils.js";
import { FluxerGateway } from "./Gateway.js";
import {
	BridgeFile,
	FluxerApiError,
	FluxerAttachment,
	FluxerMessage,
	FluxerRest,
	FluxerWebhook,
} from "./Rest.js";

const log = logger(import.meta);
const LINK_COMMAND = /^METACONCORD_LINK\s+([A-Z0-9]{8})$/i;
const MAX_BRIDGE_FILE_SIZE = 25 * 1024 * 1024;

type ChannelRoute = {
	discordChannelId: string;
	fluxerChannelId: string;
	discordParentId: string | null;
	channelKind: string;
	relayEnabled: boolean;
};

type MessageMapping = {
	discord_message_id: string;
	fluxer_message_id: string;
	discord_channel_id: string;
	fluxer_channel_id: string;
	origin: "discord" | "fluxer";
};

type MentionPayload = {
	content: string;
	users: string[];
	roles: string[];
};

type DiscordDestination = {
	webhook: Discord.Webhook<Discord.WebhookType.Incoming>;
	threadId?: string;
};

export function normalizeEmbeds(embeds: readonly unknown[], content = ""): Discord.APIEmbed[] {
	const normalized = embeds
		.filter(value => {
			const embed = value as Record<string, unknown>;
			const url = typeof embed.url === "string" ? embed.url : null;
			if (!url || !content.includes(url)) return true;
			return !(
				embed.type !== "rich" ||
				embed.provider != null ||
				embed.reference_id != null ||
				embed.content_scan_version != null
			);
		})
		.slice(0, 10)
		.map(value => {
			const embed = value as Record<string, unknown>;
			const image = embed.image as Record<string, unknown> | undefined;
			const thumbnail = embed.thumbnail as Record<string, unknown> | undefined;
			const author = embed.author as Record<string, unknown> | undefined;
			const footer = embed.footer as Record<string, unknown> | undefined;
			return {
				...(typeof embed.title === "string" ? { title: embed.title } : {}),
				...(typeof embed.description === "string"
					? { description: embed.description }
					: {}),
				...(typeof embed.url === "string" ? { url: embed.url } : {}),
				...(typeof embed.color === "number" ? { color: embed.color } : {}),
				...(typeof embed.timestamp === "string" ? { timestamp: embed.timestamp } : {}),
				...(author && typeof author.name === "string"
					? {
							author: {
								name: author.name,
								...(typeof author.url === "string" ? { url: author.url } : {}),
								...(typeof author.icon_url === "string"
									? { icon_url: author.icon_url }
									: {}),
							},
						}
					: {}),
				...(footer && typeof footer.text === "string"
					? {
							footer: {
								text: footer.text,
								...(typeof footer.icon_url === "string"
									? { icon_url: footer.icon_url }
									: {}),
							},
						}
					: {}),
				...(image && typeof image.url === "string" ? { image: { url: image.url } } : {}),
				...(thumbnail && typeof thumbnail.url === "string"
					? { thumbnail: { url: thumbnail.url } }
					: {}),
				...(Array.isArray(embed.fields)
					? {
							fields: embed.fields.slice(0, 25).flatMap(field => {
								const item = field as Record<string, unknown>;
								return typeof item.name === "string" &&
									typeof item.value === "string"
									? [
											{
												name: item.name,
												value: item.value,
												inline: item.inline === true,
											},
										]
									: [];
							}),
						}
					: {}),
			};
		});
	const result: Discord.APIEmbed[] = [];
	let characters = 0;
	for (const embed of normalized) {
		const size =
			(embed.title?.length ?? 0) +
			(embed.description?.length ?? 0) +
			(embed.author?.name.length ?? 0) +
			(embed.footer?.text.length ?? 0) +
			(embed.fields?.reduce(
				(total, field) => total + field.name.length + field.value.length,
				0
			) ?? 0);
		if (characters + size > 6000) break;
		characters += size;
		result.push(embed);
	}
	return result;
}

export function componentEmbeds(components: readonly unknown[]): Discord.APIEmbed[] {
	const embeds: Discord.APIEmbed[] = [];
	for (const value of components) {
		const container = value as Record<string, unknown>;
		if (container.type !== 17 || !Array.isArray(container.components)) continue;
		const lines: string[] = [];
		let thumbnail: string | undefined;
		let image: string | undefined;
		const visit = (componentValue: unknown) => {
			const component = componentValue as Record<string, unknown>;
			if (component.type === 10 && typeof component.content === "string") {
				lines.push(component.content);
			} else if (component.type === 9) {
				if (Array.isArray(component.components)) component.components.forEach(visit);
				const accessory = component.accessory as Record<string, unknown> | undefined;
				const media = accessory?.media as Record<string, unknown> | undefined;
				if (!thumbnail && typeof media?.url === "string") thumbnail = media.url;
			} else if (component.type === 12 && Array.isArray(component.items)) {
				const item = component.items[0] as Record<string, unknown> | undefined;
				const media = item?.media as Record<string, unknown> | undefined;
				if (!image && typeof media?.url === "string") image = media.url;
			} else if (component.type === 1 && Array.isArray(component.components)) {
				for (const buttonValue of component.components) {
					const button = buttonValue as Record<string, unknown>;
					if (typeof button.url === "string") {
						lines.push(
							`[${typeof button.label === "string" ? button.label : "Open"}](${button.url})`
						);
					}
				}
			} else if (component.type === 14 && lines.at(-1) !== "") {
				lines.push("");
			}
		};
		container.components.forEach(visit);
		const description = lines.join("\n").trim().slice(0, 4096);
		if (!description && !thumbnail && !image) continue;
		embeds.push({
			...(description ? { description } : {}),
			...(typeof container.accent_color === "number"
				? { color: container.accent_color }
				: {}),
			...(thumbnail ? { thumbnail: { url: thumbnail } } : {}),
			...(image ? { image: { url: image } } : {}),
		});
	}
	return embeds;
}

export function componentFallbackText(components: readonly unknown[]) {
	const lines: string[] = [];
	const visit = (value: unknown) => {
		const component = value as Record<string, unknown>;
		if (component.type === 10 && typeof component.content === "string") {
			lines.push(component.content);
		}
		if (typeof component.url === "string") {
			lines.push(
				`[${typeof component.label === "string" ? component.label : "Open"}](${component.url})`
			);
		}
		if (Array.isArray(component.components)) component.components.forEach(visit);
	};
	components.forEach(visit);
	return lines.join("\n").trim();
}

export type UnmappedEmoji = {
	id: string;
	name: string;
	animated: boolean;
};

export function discordEmojiCdnUrl(id: string, animated: boolean): string {
	return `https://cdn.discordapp.com/emojis/${id}.${animated ? "gif" : "png"}`;
}

export function rewriteEmojiMarkup(
	content: string,
	lookup: (id: string) => string | undefined,
	onUnmapped?: (emoji: UnmappedEmoji) => void
): string {
	return content.replace(/<(a?):([^:>]+):(\d+)>/g, (_match, animated, name, id) => {
		const target = lookup(id);
		if (target) return `<${animated}:${name}:${target}>`;
		onUnmapped?.({ id, name, animated: animated === "a" });
		return `:${name}:`;
	});
}

function appendContent(content: string, additions: string[], limit: number) {
	const combined = [content, ...additions].filter(Boolean).join("\n");
	if (combined.length <= limit) return combined;
	return `${combined.slice(0, Math.max(0, limit - 1))}…`;
}

export class Fluxer extends Service {
	name = "Fluxer";
	private sql!: SQL;
	private discordBot!: DiscordBot;
	private rest!: FluxerRest;
	private gateway?: FluxerGateway;
	private readonly routesByDiscord = new Map<string, ChannelRoute>();
	private readonly routesByFluxer = new Map<string, ChannelRoute>();
	private readonly fluxerRolesByDiscord = new Map<string, string>();
	private readonly discordRolesByFluxer = new Map<string, string>();
	private readonly fluxerUsersByDiscord = new Map<string, string>();
	private readonly discordUsersByFluxer = new Map<string, string>();
	private readonly fluxerWebhooks = new Map<string, Promise<FluxerWebhook>>();
	private readonly discordWebhooks = new Map<string, Promise<DiscordDestination>>();
	private readonly fluxerBridgeWebhookIds = new Set<string>();
	private readonly discordBridgeWebhookIds = new Set<string>();
	private readonly queues = new Map<string, Promise<void>>();
	private readonly suppressedDiscordDeletes = new Set<string>();
	private readonly suppressedFluxerDeletes = new Set<string>();
	private readonly emojiFluxerByDiscord = new Map<string, string>();
	private readonly emojiDiscordByFluxer = new Map<string, string>();
	private readonly stickerFluxerByDiscord = new Map<string, string>();

	constructor(container: Container) {
		super(container);
	}

	async init() {
		this.sql = this.container.getService("SQL");
		this.discordBot = this.container.getService("DiscordBot");
		this.rest = new FluxerRest(config.apiBaseUrl, config.botToken);
		await this.initializeSchema();
		await this.seedMappings();
		await this.loadMappings();
		if (!config.enabled) {
			log.info("Fluxer bridge is disabled");
			return;
		}
		this.attachDiscordListeners();
		this.gateway = new FluxerGateway(
			this.rest,
			config.botToken,
			config.guildId,
			(event, data) => this.handleFluxerDispatch(event, data)
		);
		this.gateway.start();
		void this.backfillPermanentMessages().catch(error =>
			log.error({ err: error }, "Fluxer permanent-message backfill failed")
		);
		log.info(
			{
				relayChannels: [...this.routesByDiscord.values()].filter(
					route => route.relayEnabled
				).length,
			},
			"Fluxer bridge initialized"
		);
	}

	async createLinkCode(discordUserId: string) {
		if (!config.enabled) throw new Error("Fluxer bridge is disabled");
		const database = this.sql.getLocalDatabase();
		const code = randomBytes(4).toString("hex").toUpperCase();
		const expiresAt = Date.now() + 10 * 60 * 1000;
		await database.run(
			"DELETE FROM fluxer_link_codes WHERE discord_user_id = ?",
			discordUserId
		);
		await database.run(
			"INSERT INTO fluxer_link_codes (code, discord_user_id, expires_at_ms) VALUES (?, ?, ?)",
			code,
			discordUserId,
			expiresAt
		);
		return { code, expiresAt };
	}

	private async initializeSchema() {
		await this.sql.getLocalDatabase().exec(`
			CREATE TABLE IF NOT EXISTS fluxer_channel_mappings (
				discord_channel_id TEXT PRIMARY KEY,
				fluxer_channel_id TEXT NOT NULL UNIQUE,
				discord_parent_id TEXT,
				channel_kind TEXT NOT NULL,
				relay_enabled INTEGER NOT NULL DEFAULT 0 CHECK (relay_enabled IN (0, 1)),
				updated_at_ms INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS fluxer_role_mappings (
				discord_role_id TEXT PRIMARY KEY,
				fluxer_role_id TEXT NOT NULL UNIQUE,
				updated_at_ms INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS fluxer_message_mappings (
				discord_message_id TEXT PRIMARY KEY,
				fluxer_message_id TEXT NOT NULL UNIQUE,
				discord_channel_id TEXT NOT NULL,
				fluxer_channel_id TEXT NOT NULL,
				origin TEXT NOT NULL CHECK (origin IN ('discord', 'fluxer')),
				created_at_ms INTEGER NOT NULL
			);
			CREATE INDEX IF NOT EXISTS fluxer_message_mappings_created
				ON fluxer_message_mappings(created_at_ms);
			CREATE TABLE IF NOT EXISTS fluxer_user_links (
				discord_user_id TEXT PRIMARY KEY,
				fluxer_user_id TEXT NOT NULL UNIQUE,
				created_at_ms INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS fluxer_link_codes (
				code TEXT PRIMARY KEY,
				discord_user_id TEXT NOT NULL UNIQUE,
				expires_at_ms INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS fluxer_emoji_mappings (
				discord_emoji_id TEXT PRIMARY KEY,
				fluxer_emoji_id TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				animated INTEGER NOT NULL CHECK (animated IN (0, 1)),
				updated_at_ms INTEGER NOT NULL
			);
			CREATE TABLE IF NOT EXISTS fluxer_sticker_mappings (
				discord_sticker_id TEXT PRIMARY KEY,
				fluxer_sticker_id TEXT NOT NULL UNIQUE,
				name TEXT NOT NULL,
				updated_at_ms INTEGER NOT NULL
			);
		`);
	}

	private async loadMappings() {
		const database = this.sql.getLocalDatabase();
		const channelRows = await database.all<
			{
				discord_channel_id: string;
				fluxer_channel_id: string;
				discord_parent_id: string | null;
				channel_kind: string;
				relay_enabled: number;
			}[]
		>("SELECT * FROM fluxer_channel_mappings");
		for (const row of channelRows) {
			const route: ChannelRoute = {
				discordChannelId: row.discord_channel_id,
				fluxerChannelId: row.fluxer_channel_id,
				discordParentId: row.discord_parent_id,
				channelKind: row.channel_kind,
				relayEnabled: row.relay_enabled === 1,
			};
			this.routesByDiscord.set(route.discordChannelId, route);
			this.routesByFluxer.set(route.fluxerChannelId, route);
		}
		const roleRows = await database.all<{ discord_role_id: string; fluxer_role_id: string }[]>(
			"SELECT discord_role_id, fluxer_role_id FROM fluxer_role_mappings"
		);
		for (const row of roleRows) {
			this.fluxerRolesByDiscord.set(row.discord_role_id, row.fluxer_role_id);
			this.discordRolesByFluxer.set(row.fluxer_role_id, row.discord_role_id);
		}
		const userRows = await database.all<{ discord_user_id: string; fluxer_user_id: string }[]>(
			"SELECT discord_user_id, fluxer_user_id FROM fluxer_user_links"
		);
		for (const row of userRows) {
			this.fluxerUsersByDiscord.set(row.discord_user_id, row.fluxer_user_id);
			this.discordUsersByFluxer.set(row.fluxer_user_id, row.discord_user_id);
		}
		const emojiRows = await database.all<
			{ discord_emoji_id: string; fluxer_emoji_id: string }[]
		>("SELECT discord_emoji_id, fluxer_emoji_id FROM fluxer_emoji_mappings");
		for (const row of emojiRows) {
			this.emojiFluxerByDiscord.set(row.discord_emoji_id, row.fluxer_emoji_id);
			this.emojiDiscordByFluxer.set(row.fluxer_emoji_id, row.discord_emoji_id);
		}
		const stickerRows = await database.all<
			{ discord_sticker_id: string; fluxer_sticker_id: string }[]
		>("SELECT discord_sticker_id, fluxer_sticker_id FROM fluxer_sticker_mappings");
		for (const row of stickerRows) {
			this.stickerFluxerByDiscord.set(row.discord_sticker_id, row.fluxer_sticker_id);
		}
	}

	private async seedMappings() {
		const database = this.sql.getLocalDatabase();
		await database.exec("BEGIN IMMEDIATE");
		try {
			const updatedAt = Date.now();
			await database.run("DELETE FROM fluxer_channel_mappings");
			for (const route of mappingSeed.channels) {
				await database.run(
					`INSERT INTO fluxer_channel_mappings
						(discord_channel_id, fluxer_channel_id, discord_parent_id, channel_kind, relay_enabled, updated_at_ms)
					 VALUES (?, ?, ?, ?, ?, ?)
					 ON CONFLICT(discord_channel_id) DO UPDATE SET
						fluxer_channel_id = excluded.fluxer_channel_id,
						discord_parent_id = excluded.discord_parent_id,
						channel_kind = excluded.channel_kind,
						relay_enabled = excluded.relay_enabled,
						updated_at_ms = excluded.updated_at_ms`,
					route.discordChannelId,
					route.fluxerChannelId,
					route.discordParentId,
					route.channelKind,
					route.relayEnabled ? 1 : 0,
					updatedAt
				);
			}
			await database.run("DELETE FROM fluxer_role_mappings");
			for (const role of mappingSeed.roles) {
				await database.run(
					`INSERT INTO fluxer_role_mappings (discord_role_id, fluxer_role_id, updated_at_ms)
					 VALUES (?, ?, ?)
					 ON CONFLICT(discord_role_id) DO UPDATE SET
						fluxer_role_id = excluded.fluxer_role_id,
						updated_at_ms = excluded.updated_at_ms`,
					role.discordRoleId,
					role.fluxerRoleId,
					updatedAt
				);
			}
			await database.exec("COMMIT");
		} catch (error) {
			await database.exec("ROLLBACK");
			throw error;
		}
	}

	private attachDiscordListeners() {
		this.discordBot.discord.on("messageCreate", message => {
			this.enqueue(`discord:${message.channelId}`, () => this.relayDiscordCreate(message));
		});
		this.discordBot.discord.on("messageUpdate", (_oldMessage, message) => {
			this.enqueue(`discord:${message.channelId}`, () => this.relayDiscordUpdate(message));
		});
		this.discordBot.discord.on("messageDelete", message => {
			this.enqueue(`discord:${message.channelId}`, () => this.relayDiscordDelete(message.id));
		});
		this.discordBot.discord.on("messageDeleteBulk", messages => {
			for (const message of messages.values()) {
				this.enqueue(`discord:${message.channelId}`, () =>
					this.relayDiscordDelete(message.id)
				);
			}
		});
	}

	private enqueue(key: string, operation: () => Promise<void>) {
		const previous = this.queues.get(key) ?? Promise.resolve();
		const current = previous
			.catch(() => undefined)
			.then(operation)
			.catch(error => log.error({ err: error, queue: key }, "Bridge operation failed"))
			.finally(() => {
				if (this.queues.get(key) === current) this.queues.delete(key);
			});
		this.queues.set(key, current);
		return current;
	}

	private async relayDiscordCreate(message: Discord.Message | Discord.PartialMessage) {
		if (!config.enabled || message.guildId !== this.discordBot.config.bot.primaryGuildId)
			return;
		if (message.webhookId && this.discordBridgeWebhookIds.has(message.webhookId)) return;
		const route = this.routesByDiscord.get(message.channelId);
		if (!route?.relayEnabled || (await this.mappingByDiscordMessage(message.id))) return;
		if (message.partial) message = await message.fetch();
		if (message.system) return;
		const payload = this.translateDiscordMessage(message);
		const { attachments, fallbackUrls } = await this.prepareFluxerAttachments(route, [
			...message.attachments.values(),
		]);
		const stickerIds = [...message.stickers.values()]
			.map(sticker => this.stickerFluxerByDiscord.get(sticker.id))
			.filter((id): id is string => Boolean(id))
			.slice(0, 3);
		const fallbackStickerUrls = [...message.stickers.values()]
			.filter(sticker => !this.stickerFluxerByDiscord.has(sticker.id))
			.map(sticker => sticker.url);
		payload.content = appendContent(
			payload.content,
			fallbackStickerUrls.concat(fallbackUrls),
			4000
		);
		const components = message.components.map(component => component.toJSON());
		const embeds = normalizeEmbeds(
			[...message.embeds.map(embed => embed.toJSON()), ...componentEmbeds(components)],
			message.content
		);
		if (!payload.content && embeds.length === 0 && attachments.length === 0) {
			payload.content =
				componentFallbackText(components).slice(0, 4000) ||
				`[View this Discord message](${message.url})`;
		}
		const reply = message.reference?.messageId
			? await this.mappingByDiscordMessage(message.reference.messageId)
			: undefined;
		const sent = await this.withFluxerWebhook(route.fluxerChannelId, webhook =>
			this.rest.request<FluxerMessage>(
				"POST",
				`/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}?wait=true`,
				{
					content: payload.content || null,
					nonce: message.id,
					username: (message.member?.displayName ?? message.author.displayName).slice(
						0,
						80
					),
					avatar_url: message.author.displayAvatarURL({ size: 128 }),
					...(embeds.length > 0 ? { embeds } : {}),
					attachments,
					...(stickerIds.length > 0 ? { sticker_ids: stickerIds } : {}),
					allowed_mentions: {
						parse: [],
						users: payload.users,
						roles: payload.roles,
						replied_user: false,
					},
					...(reply
						? {
								message_reference: {
									message_id: reply.fluxer_message_id,
									channel_id: reply.fluxer_channel_id,
									type: 0,
								},
							}
						: {}),
				},
				false,
				true
			)
		);
		await this.saveMessageMapping(message.id, sent.id, route, "discord");
	}

	private async backfillPermanentMessages() {
		if (!this.discordBot.discord.isReady()) {
			await new Promise<void>(resolve =>
				this.discordBot.discord.once("clientReady", () => resolve())
			);
		}
		let examined = 0;
		for (const channelId of mappingSeed.permanentMessageChannelIds) {
			const route = this.routesByDiscord.get(channelId);
			if (!route?.relayEnabled) {
				log.warn({ channelId, route }, "Skipping permanent-message backfill route");
				continue;
			}
			const channel = await this.discordBot.discord.channels.fetch(channelId);
			if (!channel?.isTextBased() || !("messages" in channel)) {
				log.warn(
					{ channelId, channelType: channel?.type },
					"Backfill channel is not text-based"
				);
				continue;
			}
			const messages = await channel.messages.fetch({ limit: 100 });
			for (const message of [...messages.values()].sort(
				(a, b) => a.createdTimestamp - b.createdTimestamp
			)) {
				await this.enqueue(`discord:${channelId}`, () => this.relayDiscordCreate(message));
				examined++;
			}
		}
		log.info({ examinedMessages: examined }, "Fluxer permanent-message backfill complete");
	}

	private async relayDiscordUpdate(message: Discord.Message | Discord.PartialMessage) {
		if (!config.enabled) return;
		if (message.webhookId && this.discordBridgeWebhookIds.has(message.webhookId)) return;
		const mapping = await this.mappingByDiscordMessage(message.id);
		const route = mapping ? this.routesByDiscord.get(mapping.discord_channel_id) : undefined;
		if (!mapping || mapping.origin !== "discord" || !route?.relayEnabled) return;
		if (message.partial) message = await message.fetch();
		const payload = this.translateDiscordMessage(message);
		payload.content = appendContent(
			payload.content,
			[...message.stickers.values()].map(sticker => sticker.url),
			4000
		);
		const components = message.components.map(component => component.toJSON());
		const embeds = normalizeEmbeds(
			[...message.embeds.map(embed => embed.toJSON()), ...componentEmbeds(components)],
			message.content
		);
		if (
			!payload.content &&
			embeds.length === 0 &&
			message.attachments.size === 0 &&
			message.stickers.size === 0
		) {
			payload.content =
				componentFallbackText(components).slice(0, 4000) ||
				`[View this Discord message](${message.url})`;
		}
		await this.withFluxerWebhook(mapping.fluxer_channel_id, webhook =>
			this.rest.request(
				"PATCH",
				`/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}/messages/${mapping.fluxer_message_id}`,
				{
					content: payload.content || null,
					...(embeds.length > 0 ? { embeds } : {}),
					allowed_mentions: {
						parse: [],
						users: payload.users,
						roles: payload.roles,
						replied_user: false,
					},
				},
				false
			)
		);
	}

	private async relayDiscordDelete(messageId: string) {
		if (!config.enabled) return;
		if (this.suppressedDiscordDeletes.delete(messageId)) return;
		const mapping = await this.mappingByDiscordMessage(messageId);
		const route = mapping ? this.routesByDiscord.get(mapping.discord_channel_id) : undefined;
		if (!mapping || !route?.relayEnabled) return;
		this.suppress(this.suppressedFluxerDeletes, mapping.fluxer_message_id);
		try {
			if (mapping.origin === "discord") {
				await this.withFluxerWebhook(mapping.fluxer_channel_id, webhook =>
					this.rest.request(
						"DELETE",
						`/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}/messages/${mapping.fluxer_message_id}`,
						undefined,
						false
					)
				);
			} else {
				await this.rest.request(
					"DELETE",
					`/channels/${mapping.fluxer_channel_id}/messages/${mapping.fluxer_message_id}`
				);
			}
		} catch (error) {
			if (!(error instanceof FluxerApiError) || error.status !== 404) throw error;
		}
		await this.deleteMessageMapping(mapping);
	}

	private async handleFluxerDispatch(event: string, data: unknown) {
		if (event === "MESSAGE_CREATE") {
			const message = data as FluxerMessage;
			if (message.guild_id !== config.guildId) return;
			if (await this.handleLinkCommand(message)) return;
			await this.relayFluxerCreate(message);
		} else if (event === "MESSAGE_UPDATE") {
			await this.relayFluxerUpdate(data as FluxerMessage);
		} else if (event === "MESSAGE_DELETE") {
			const message = data as { id: string; channel_id: string };
			await this.relayFluxerDelete(message.id);
		} else if (event === "MESSAGE_DELETE_BULK") {
			const payload = data as { ids: string[] };
			for (const id of payload.ids) await this.relayFluxerDelete(id);
		}
	}

	private async relayFluxerCreate(message: FluxerMessage) {
		if (message.guild_id !== config.guildId) return;
		if (message.type !== 0 && message.type !== 19) return;
		if (message.author.id === config.applicationId) return;
		if (message.webhook_id && this.fluxerBridgeWebhookIds.has(message.webhook_id)) return;
		const route = this.routesByFluxer.get(message.channel_id);
		if (!route?.relayEnabled || (await this.mappingByFluxerMessage(message.id))) return;
		const payload = this.translateFluxerMessage(message);
		payload.content = appendContent(
			payload.content,
			(message.stickers ?? []).map(
				sticker => `${config.mediaBaseUrl}/stickers/${sticker.id}.png`
			),
			2000
		);
		const { files, fallbackUrls } = await this.prepareDiscordAttachments(
			message.attachments ?? []
		);
		payload.content = await this.fluxerReplyContent(message, payload.content, fallbackUrls);
		const embeds = normalizeEmbeds(message.embeds ?? [], message.content);
		const destination = await this.getDiscordWebhook(route);
		const sent = await destination.webhook.send({
			content: payload.content || undefined,
			username: this.fluxerDisplayName(message).slice(0, 80),
			avatarURL: this.fluxerAvatarUrl(message),
			...(embeds.length > 0 ? { embeds } : {}),
			files,
			allowedMentions: {
				parse: [],
				users: payload.users,
				roles: payload.roles,
				repliedUser: false,
			},
			...(destination.threadId ? { threadId: destination.threadId } : {}),
		});
		await this.saveMessageMapping(sent.id, message.id, route, "fluxer");
	}

	private async relayFluxerUpdate(message: FluxerMessage) {
		if (!config.enabled) return;
		if (message.webhook_id && this.fluxerBridgeWebhookIds.has(message.webhook_id)) return;
		const mapping = await this.mappingByFluxerMessage(message.id);
		if (!mapping || mapping.origin !== "fluxer") return;
		const route = this.routesByFluxer.get(mapping.fluxer_channel_id);
		if (!route?.relayEnabled) return;
		const payload = this.translateFluxerMessage(message);
		payload.content = appendContent(
			payload.content,
			(message.stickers ?? []).map(
				sticker => `${config.mediaBaseUrl}/stickers/${sticker.id}.png`
			),
			2000
		);
		const { files, fallbackUrls } = await this.prepareDiscordAttachments(
			message.attachments ?? []
		);
		payload.content = await this.fluxerReplyContent(message, payload.content, fallbackUrls);
		const embeds = normalizeEmbeds(message.embeds ?? [], message.content);
		const destination = await this.getDiscordWebhook(route);
		await destination.webhook.editMessage(mapping.discord_message_id, {
			content: payload.content || null,
			...(embeds.length > 0 ? { embeds } : {}),
			attachments: [],
			files,
			allowedMentions: {
				parse: [],
				users: payload.users,
				roles: payload.roles,
				repliedUser: false,
			},
			...(destination.threadId ? { threadId: destination.threadId } : {}),
		});
	}

	private async relayFluxerDelete(messageId: string) {
		if (!config.enabled) return;
		if (this.suppressedFluxerDeletes.delete(messageId)) return;
		const mapping = await this.mappingByFluxerMessage(messageId);
		if (!mapping) return;
		const route = this.routesByFluxer.get(mapping.fluxer_channel_id);
		if (!route?.relayEnabled) return;
		this.suppress(this.suppressedDiscordDeletes, mapping.discord_message_id);
		try {
			if (mapping.origin === "fluxer") {
				const destination = await this.getDiscordWebhook(route);
				await destination.webhook.deleteMessage(
					mapping.discord_message_id,
					destination.threadId
				);
			} else {
				const channel = await this.discordBot.discord.channels.fetch(
					mapping.discord_channel_id
				);
				if (!channel?.isTextBased() || !("messages" in channel)) {
					throw new Error(
						`Discord channel ${mapping.discord_channel_id} has no messages`
					);
				}
				await channel.messages.delete(mapping.discord_message_id);
			}
		} catch (error) {
			if ((error as { code?: number }).code !== 10008) throw error;
		}
		await this.deleteMessageMapping(mapping);
	}

	private translateDiscordMessage(message: Discord.Message): MentionPayload {
		const users = new Set<string>();
		const roles = new Set<string>();
		const emojiFallbackById = new Map<string, UnmappedEmoji>();
		let content = message.content
			.replace(/<@&(\d+)>/g, (_match, id) => {
				const mapped = this.fluxerRolesByDiscord.get(id);
				if (mapped) {
					if (message.mentions.roles.has(id)) roles.add(mapped);
					return `<@&${mapped}>`;
				}
				return `@${message.guild?.roles.cache.get(id)?.name ?? "role"}`;
			})
			.replace(/<@!?(\d+)>/g, (_match, id) => {
				const mapped = this.fluxerUsersByDiscord.get(id);
				if (mapped) {
					if (message.mentions.users.has(id)) users.add(mapped);
					return `<@${mapped}>`;
				}
				return `@${message.mentions.users.get(id)?.displayName ?? "user"}`;
			})
			.replace(/<#(\d+)>/g, (_match, id) => {
				const route = this.routesByDiscord.get(id);
				return route
					? `<#${route.fluxerChannelId}>`
					: `#${message.guild?.channels.cache.get(id)?.name ?? "channel"}`;
			});
		content = rewriteEmojiMarkup(
			content,
			id => this.emojiFluxerByDiscord.get(id),
			emoji => {
				if (!emojiFallbackById.has(emoji.id)) emojiFallbackById.set(emoji.id, emoji);
			}
		);
		if (emojiFallbackById.size > 0) {
			content = appendContent(
				content,
				[...emojiFallbackById.values()].map(emoji =>
					discordEmojiCdnUrl(emoji.id, emoji.animated)
				),
				4000
			);
		}
		content = content.replace(
			/https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/g,
			(match, _guildId, channelId, messageId) => {
				if (messageId) return match;
				const route = this.routesByDiscord.get(channelId);
				if (!route) return match;
				return `${config.webAppBaseUrl}/channels/${config.guildId}/${route.fluxerChannelId}`;
			}
		);
		return { content, users: [...users].slice(0, 100), roles: [...roles].slice(0, 100) };
	}

	private translateFluxerMessage(message: FluxerMessage): MentionPayload {
		const users = new Set<string>();
		const roles = new Set<string>();
		let content = message.content
			.replace(/<@&(\d+)>/g, (_match, id) => {
				const mapped = this.discordRolesByFluxer.get(id);
				if (mapped) {
					if (message.mention_roles.includes(id)) roles.add(mapped);
					return `<@&${mapped}>`;
				}
				return "@role";
			})
			.replace(/<@!?(\d+)>/g, (_match, id) => {
				const mapped = this.discordUsersByFluxer.get(id);
				if (mapped) {
					if (message.mentions.some(user => user.id === id)) users.add(mapped);
					return `<@${mapped}>`;
				}
				const user = message.mentions.find(item => item.id === id);
				return `@${user?.global_name ?? user?.username ?? "user"}`;
			})
			.replace(/<#(\d+)>/g, (_match, id) => {
				const route = this.routesByFluxer.get(id);
				return route ? `<#${route.discordChannelId}>` : "#channel";
			});
		content = rewriteEmojiMarkup(content, id => this.emojiDiscordByFluxer.get(id));
		return { content, users: [...users].slice(0, 100), roles: [...roles].slice(0, 100) };
	}

	private async prepareFluxerAttachments(route: ChannelRoute, attachments: Discord.Attachment[]) {
		const files: BridgeFile[] = [];
		const fallbackUrls: string[] = [];
		for (const attachment of attachments.slice(0, 10)) {
			const data = await this.download(attachment.url, attachment.size);
			if (!data) {
				fallbackUrls.push(attachment.url);
				continue;
			}
			files.push({
				name: attachment.name,
				type: attachment.contentType ?? "application/octet-stream",
				data,
				description: attachment.description,
			});
		}
		try {
			return {
				attachments: await this.rest.uploadAttachments(route.fluxerChannelId, files),
				fallbackUrls,
			};
		} catch (error) {
			log.warn({ err: error }, "Fluxer attachment upload failed; relaying source URLs");
			return {
				attachments: [],
				fallbackUrls: [...new Set(fallbackUrls.concat(attachments.map(item => item.url)))],
			};
		}
	}

	private async prepareDiscordAttachments(attachments: FluxerAttachment[]) {
		const files: Discord.AttachmentPayload[] = [];
		const fallbackUrls: string[] = [];
		for (const attachment of attachments.slice(0, 10)) {
			if (!attachment.url) continue;
			const data = await this.download(attachment.url, attachment.size);
			if (!data) {
				fallbackUrls.push(attachment.url);
				continue;
			}
			files.push({
				attachment: data,
				name: attachment.filename,
				description: attachment.description ?? undefined,
			});
		}
		return { files, fallbackUrls };
	}

	private async download(url: string, expectedSize: number) {
		if (expectedSize > MAX_BRIDGE_FILE_SIZE) return null;
		try {
			const response = await fetch(url, { signal: AbortSignal.timeout(60_000) });
			if (!response.ok) return null;
			const contentLength = Number(response.headers.get("Content-Length") ?? expectedSize);
			if (contentLength > MAX_BRIDGE_FILE_SIZE) return null;
			const data = Buffer.from(await response.arrayBuffer());
			return data.length <= MAX_BRIDGE_FILE_SIZE ? data : null;
		} catch (error) {
			log.warn({ err: error, url }, "Bridge attachment download failed");
			return null;
		}
	}

	private async getFluxerWebhook(channelId: string) {
		let pending = this.fluxerWebhooks.get(channelId);
		if (!pending) {
			pending = (async () => {
				const webhooks = await this.rest.request<FluxerWebhook[]>(
					"GET",
					`/channels/${channelId}/webhooks`
				);
				let webhook = webhooks.find(
					item =>
						item.name === config.webhookName && item.user.id === config.applicationId
				);
				if (!webhook) {
					webhook = await this.rest.request<FluxerWebhook>(
						"POST",
						`/channels/${channelId}/webhooks`,
						{ name: config.webhookName }
					);
				}
				this.fluxerBridgeWebhookIds.add(webhook.id);
				return webhook;
			})();
			this.fluxerWebhooks.set(channelId, pending);
			pending.catch(() => this.fluxerWebhooks.delete(channelId));
		}
		return pending;
	}

	private async withFluxerWebhook<T>(
		channelId: string,
		operation: (webhook: FluxerWebhook) => Promise<T>
	) {
		for (let attempt = 0; ; attempt++) {
			const webhook = await this.getFluxerWebhook(channelId);
			try {
				return await operation(webhook);
			} catch (error) {
				if (
					attempt > 0 ||
					!(error instanceof FluxerApiError) ||
					![401, 404].includes(error.status)
				)
					throw error;
				this.fluxerWebhooks.delete(channelId);
			}
		}
	}

	private async getDiscordWebhook(route: ChannelRoute): Promise<DiscordDestination> {
		const webhookChannelId =
			route.channelKind === "thread" ? route.discordParentId! : route.discordChannelId;
		let pending = this.discordWebhooks.get(webhookChannelId);
		if (!pending) {
			pending = (async () => {
				const channel = await this.discordBot.discord.channels.fetch(webhookChannelId);
				if (!channel || !("fetchWebhooks" in channel) || !("createWebhook" in channel)) {
					throw new Error(`Discord channel ${webhookChannelId} cannot own webhooks`);
				}
				const webhookChannel = channel as Discord.TextChannel;
				const webhooks = await webhookChannel.fetchWebhooks();
				let webhook = webhooks.find(
					item =>
						item.type === Discord.WebhookType.Incoming &&
						item.name === config.webhookName &&
						item.owner?.id === this.discordBot.discord.user?.id &&
						item.token
				) as Discord.Webhook<Discord.WebhookType.Incoming> | undefined;
				if (!webhook) {
					webhook = await webhookChannel.createWebhook({ name: config.webhookName });
				}
				this.discordBridgeWebhookIds.add(webhook.id);
				return {
					webhook,
					...(route.channelKind === "thread" ? { threadId: route.discordChannelId } : {}),
				};
			})();
			this.discordWebhooks.set(webhookChannelId, pending);
			pending.catch(() => this.discordWebhooks.delete(webhookChannelId));
		}
		const destination = await pending;
		return {
			webhook: destination.webhook,
			...(route.channelKind === "thread" ? { threadId: route.discordChannelId } : {}),
		};
	}

	private fluxerDisplayName(message: FluxerMessage) {
		return message.member?.nick ?? message.author.global_name ?? message.author.username;
	}

	private fluxerAvatarUrl(message: FluxerMessage) {
		if (!message.author.avatar) return undefined;
		const extension = message.author.avatar.startsWith("a_") ? "gif" : "png";
		return `${config.mediaBaseUrl}/avatars/${message.author.id}/${message.author.avatar}.${extension}`;
	}

	private async fluxerReplyContent(
		message: FluxerMessage,
		content: string,
		additions: string[] = []
	) {
		const reply = message.message_reference?.message_id
			? await this.mappingByFluxerMessage(message.message_reference.message_id)
			: undefined;
		const author = message.referenced_message?.author;
		const name = author?.global_name ?? author?.username ?? "message";
		if (!reply) {
			if (!message.message_reference) return appendContent(content, additions, 2000);
			const reference = message.message_reference;
			return appendContent(
				`> Replying to ${name}: ${config.webAppBaseUrl}/channels/${config.guildId}/${reference.channel_id}/${reference.message_id}`,
				[content, ...additions],
				2000
			);
		}
		return appendContent(
			`> Replying to ${name}: https://discord.com/channels/${this.discordBot.config.bot.primaryGuildId}/${reply.discord_channel_id}/${reply.discord_message_id}`,
			[content, ...additions],
			2000
		);
	}

	private async handleLinkCommand(message: FluxerMessage) {
		const match = message.content.match(LINK_COMMAND);
		const route = this.routesByFluxer.get(message.channel_id);
		if (!match || message.author.bot || message.webhook_id || !route?.relayEnabled)
			return false;
		const database = this.sql.getLocalDatabase();
		let response = "That link code is invalid or expired.";
		let code: { discord_user_id: string } | undefined;
		let previousFluxerUser: string | undefined;
		let previousDiscordUser: string | undefined;
		await database.exec("BEGIN IMMEDIATE");
		try {
			code = await database.get<{ discord_user_id: string }>(
				"DELETE FROM fluxer_link_codes WHERE code = ? AND expires_at_ms > ? RETURNING discord_user_id",
				match[1].toUpperCase(),
				Date.now()
			);
			if (code) {
				previousFluxerUser = this.fluxerUsersByDiscord.get(code.discord_user_id);
				previousDiscordUser = this.discordUsersByFluxer.get(message.author.id);
				await database.run(
					"DELETE FROM fluxer_user_links WHERE discord_user_id = ? OR fluxer_user_id = ?",
					code.discord_user_id,
					message.author.id
				);
				await database.run(
					"INSERT INTO fluxer_user_links (discord_user_id, fluxer_user_id, created_at_ms) VALUES (?, ?, ?)",
					code.discord_user_id,
					message.author.id,
					Date.now()
				);
			}
			await database.exec("COMMIT");
		} catch (error) {
			await database.exec("ROLLBACK");
			throw error;
		}
		if (code) {
			if (previousFluxerUser) this.discordUsersByFluxer.delete(previousFluxerUser);
			if (previousDiscordUser) this.fluxerUsersByDiscord.delete(previousDiscordUser);
			this.fluxerUsersByDiscord.set(code.discord_user_id, message.author.id);
			this.discordUsersByFluxer.set(message.author.id, code.discord_user_id);
			response = "Your Discord and Fluxer accounts are now linked for bridge mentions.";
		}
		await this.rest.request("DELETE", `/channels/${message.channel_id}/messages/${message.id}`);
		await this.rest.request("POST", `/channels/${message.channel_id}/messages`, {
			content: response,
			allowed_mentions: { parse: [], users: [], roles: [], replied_user: false },
		});
		return true;
	}

	private async mappingByDiscordMessage(id: string) {
		return this.sql
			.getLocalDatabase()
			.get<MessageMapping>(
				"SELECT * FROM fluxer_message_mappings WHERE discord_message_id = ?",
				id
			);
	}

	private async mappingByFluxerMessage(id: string) {
		return this.sql
			.getLocalDatabase()
			.get<MessageMapping>(
				"SELECT * FROM fluxer_message_mappings WHERE fluxer_message_id = ?",
				id
			);
	}

	private async saveMessageMapping(
		discordMessageId: string,
		fluxerMessageId: string,
		route: ChannelRoute,
		origin: "discord" | "fluxer"
	) {
		await this.sql.getLocalDatabase().run(
			`INSERT OR IGNORE INTO fluxer_message_mappings
				(discord_message_id, fluxer_message_id, discord_channel_id, fluxer_channel_id, origin, created_at_ms)
			 VALUES (?, ?, ?, ?, ?, ?)`,
			discordMessageId,
			fluxerMessageId,
			route.discordChannelId,
			route.fluxerChannelId,
			origin,
			Date.now()
		);
	}

	private async deleteMessageMapping(mapping: MessageMapping) {
		await this.sql
			.getLocalDatabase()
			.run(
				"DELETE FROM fluxer_message_mappings WHERE discord_message_id = ?",
				mapping.discord_message_id
			);
	}

	private suppress(set: Set<string>, id: string) {
		set.add(id);
		setTimeout(() => set.delete(id), 30_000).unref();
	}
}

export default (container: Container): Service => new Fluxer(container);
