import { randomBytes } from "node:crypto";
import * as Discord from "discord.js";
import { LRUMapWithDelete } from "mnemonist";

import { logger } from "#utils";
import { type Container, Service } from "#/app/Container.js";
import type { DiscordBot } from "#/app/services/discord/index.js";
import type { LocalDB } from "../sql/LocalDB.js";
import { FluxerGateway } from "./Gateway.js";
import mappingSeed from "./mappings.json" with { type: "json" };
import {
	type BridgeFile,
	FluxerApiError,
	type FluxerAttachment,
	type FluxerMessage,
	type FluxerMessageEmbed,
	type FluxerMessageSnapshot,
	FluxerRest,
	type FluxerThreadChannel,
	type FluxerUser,
	type FluxerWebhook,
} from "./Rest.js";

import config from "#config/fluxer.json" with { type: "json" };

const log = logger(import.meta);
const LINK_COMMAND = /^METACONCORD_LINK\s+([A-Z0-9]{8})$/i;
const MAX_BRIDGE_FILE_SIZE = 25 * 1024 * 1024;
const DISCORD_API_BASE = "https://discord.com/api/v10";
const MAX_REFRESH_URLS = 50;
// Bare attachment links (e.g. a GIF a user saved and pasted) are unsigned and expire.
const DISCORD_ATTACHMENT_CDN =
	/https?:\/\/(?:cdn\.discordapp\.com|media\.discordapp\.net)\/attachments?\/\d+\/\d+\/[^\s<>"'`]+/g;
// Per-message mappings are stored in memory
const MESSAGE_MAPPING_CACHE_SIZE = 50_000;
const PERMANENT_MESSAGE_CHANNELS = new Set(mappingSeed.permanentMessageChannelIds);

type ChannelRoute = {
	discordChannelId: string;
	fluxerChannelId: string;
	discordParentId: string | null;
	fluxerParentId?: string | null;
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

type ThreadKind = "thread" | "forum_post";

type ThreadLink = {
	discord_thread_id: string;
	fluxer_thread_id: string;
	discord_parent_id: string;
	fluxer_parent_id: string;
	channel_kind: ThreadKind;
	relay_enabled: number;
};

type SeedThread = {
	discordThreadId: string;
	fluxerThreadId: string;
	discordParentId: string;
	fluxerParentId: string;
	channelKind: ThreadKind;
	relayEnabled: boolean;
};

type ThreadResolution = { route: ChannelRoute; handled: boolean };

const FLUXER_THREAD_TYPES = new Set([10, 11, 12]);

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

			return embed.type === "rich" &&
				!embed.provider &&
				!embed.reference_id &&
				!embed.content_scan_version;
		})
		.slice(0, 10)
		.map(value => {
			const embed = value as Record<string, unknown>;
			const image = embed.image as Record<string, unknown> | undefined;
			const thumbnail = embed.thumbnail as Record<string, unknown> | undefined;
			const author = embed.author as Record<string, unknown> | undefined;
			const footer = embed.footer as Record<string, unknown> | undefined;
			return {
				...((typeof embed.title === "string") && { title: embed.title }),
				...((typeof embed.description === "string") && { description: embed.description }),
				...((typeof embed.url === "string") && { url: embed.url }),
				...((typeof embed.color === "number") && { color: embed.color }),
				...((typeof embed.timestamp === "string") && { timestamp: embed.timestamp }),
				...(author && typeof author.name === "string" && {
					author: {
						name: author.name,
						...((typeof author.url === "string") && { url: author.url }),
						...((typeof author.icon_url === "string") && { icon_url: author.icon_url }),
					},
				}),
				...(footer && typeof footer.text === "string" && {
					footer: {
						text: footer.text,
						...((typeof footer.icon_url === "string") && { icon_url: footer.icon_url }),
					},
				}),
				...(image && typeof image.url === "string" && { image: { url: image.url } }),
				...(thumbnail && typeof thumbnail.url === "string" && { thumbnail: { url: thumbnail.url } }),
				...(Array.isArray(embed.fields) && {
					fields: embed.fields
						.slice(0, 25)
						.filter((item): item is FluxerMessageEmbed => typeof item.name === "string" && typeof item.value === "string")
						.map(item => ({
							name: item.name,
							value:
								item.value.trim().length === 0
									? "\u{200B}"
									: item.value,
							inline: item.inline,
						})),
				}),
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
			...(description && { description }),
			...((typeof container.accent_color === "number") && { color: container.accent_color }),
			...(thumbnail && { thumbnail: { url: thumbnail } }),
			...(image && { image: { url: image } }),
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
	return content.replaceAll(/<(a?):([^:>]+):(\d+)>/g, (_match, animated, name, id) => {
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

const FLUXER_FORWARD_REFERENCE_TYPE = 1;

export function isFluxerForward(message: FluxerMessage): boolean {
	return (
		message.message_reference?.type === FLUXER_FORWARD_REFERENCE_TYPE ||
		(message.message_snapshots?.length ?? 0) > 0
	);
}

export function fluxerSnapshotMentions(snapshot: FluxerMessageSnapshot): FluxerUser[] {
	return (snapshot.mentions ?? []).map(mention =>
		typeof mention === "string"
			? {
				id: mention,
				username: mention,
				discriminator: "0",
				global_name: null,
				avatar: null,
			}
			: mention
	);
}

export class Fluxer extends Service {
	override name = "Fluxer";
	private localDB!: LocalDB;
	private discordBot!: DiscordBot;
	private rest!: FluxerRest;
	private gateway?: FluxerGateway;
	private readonly routesByDiscord = new Map<string, ChannelRoute>();
	private readonly routesByFluxer = new Map<string, ChannelRoute>();
	private readonly threadLinksByDiscord = new Map<string, ThreadLink>();
	private readonly threadLinksByFluxer = new Map<string, ThreadLink>();
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
	private readonly messageMappingsByDiscord = new LRUMapWithDelete<string, MessageMapping>(MESSAGE_MAPPING_CACHE_SIZE);
	private readonly messageMappingsByFluxer = new LRUMapWithDelete<string, MessageMapping>(MESSAGE_MAPPING_CACHE_SIZE);

	constructor(container: Container) {
		super(container);
	}

	override async init() {
		this.localDB = this.container.getService("LocalDB");
		this.discordBot = this.container.getService("DiscordBot");
		this.rest = new FluxerRest(config.apiBaseUrl, config.botToken);
		await this.seedThreadLinks();
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
				relayChannels: this.routesByDiscord
					.values()
					.filter(
						route => route.relayEnabled
					)
					.toArray()
					.length,
			},
			"Fluxer bridge initialized"
		);
	}

	async createLinkCode(discordUserId: string) {
		if (!config.enabled) throw new Error("Fluxer bridge is disabled");
		const code = randomBytes(4).toString("hex").toUpperCase();
		const expiresAt = Date.now() + 10 * 60 * 1000;
		await this.localDB.db.transaction().execute(async trx => {
			await trx
				.deleteFrom("fluxer_link_codes")
				.where("discord_user_id", "=", discordUserId)
				.execute();
			await trx
				.insertInto("fluxer_link_codes")
				.values({
					code, discord_user_id: discordUserId,
					expires_at_ms: expiresAt,
				})
				.execute();
		});
		return { code, expiresAt };
	}

	private async loadMappings() {
		// Channel and role routes are static (written by the mirror tool)
		for (const entry of mappingSeed.channels) {
			const route: ChannelRoute = {
				discordChannelId: entry.discordChannelId,
				fluxerChannelId: entry.fluxerChannelId,
				discordParentId: entry.discordParentId,
				channelKind: entry.channelKind,
				relayEnabled: entry.relayEnabled,
			};
			this.routesByDiscord.set(route.discordChannelId, route);
			this.routesByFluxer.set(route.fluxerChannelId, route);
		}
		for (const entry of mappingSeed.roles) {
			this.fluxerRolesByDiscord.set(entry.discordRoleId, entry.fluxerRoleId);
			this.discordRolesByFluxer.set(entry.fluxerRoleId, entry.discordRoleId);
		}
		const db = this.localDB.db;
		const userRows = await db
			.selectFrom("fluxer_user_links")
			.select(["discord_user_id", "fluxer_user_id"])
			.execute();
		for (const row of userRows) {
			this.fluxerUsersByDiscord.set(row.discord_user_id, row.fluxer_user_id);
			this.discordUsersByFluxer.set(row.fluxer_user_id, row.discord_user_id);
		}
		const emojiRows = await db
			.selectFrom("fluxer_emoji_mappings")
			.select(["discord_emoji_id", "fluxer_emoji_id"])
			.execute();
		for (const row of emojiRows) {
			this.emojiFluxerByDiscord.set(row.discord_emoji_id, row.fluxer_emoji_id);
			this.emojiDiscordByFluxer.set(row.fluxer_emoji_id, row.discord_emoji_id);
		}
		const stickerRows = await db
			.selectFrom("fluxer_sticker_mappings")
			.select(["discord_sticker_id", "fluxer_sticker_id"])
			.execute();
		for (const row of stickerRows) {
			this.stickerFluxerByDiscord.set(row.discord_sticker_id, row.fluxer_sticker_id);
		}
		const threadRows = await db.selectFrom("fluxer_thread_links").selectAll().execute();
		for (const row of threadRows) {
			const link: ThreadLink = {
				discord_thread_id: row.discord_thread_id,
				fluxer_thread_id: row.fluxer_thread_id,
				discord_parent_id: row.discord_parent_id,
				fluxer_parent_id: row.fluxer_parent_id,
				channel_kind: row.channel_kind as ThreadKind,
				relay_enabled: row.relay_enabled,
			};
			this.threadLinksByDiscord.set(link.discord_thread_id, link);
			this.threadLinksByFluxer.set(link.fluxer_thread_id, link);
		}
		if (PERMANENT_MESSAGE_CHANNELS.size > 0) {
			const permanentRows = await db
				.selectFrom("fluxer_message_mappings")
				.selectAll()
				.where("discord_channel_id", "in", [...PERMANENT_MESSAGE_CHANNELS])
				.execute();
			for (const row of permanentRows) {
				const mapping = row as MessageMapping;
				this.messageMappingsByDiscord.set(mapping.discord_message_id, mapping);
				this.messageMappingsByFluxer.set(mapping.fluxer_message_id, mapping);
			}
		}
	}

	private async seedThreadLinks() {
		if (mappingSeed.threads.length === 0) return;
		const updatedAt = Date.now();
		// Seed mirror-created threads without dropping runtime-created links.
		await this.localDB.db
			.insertInto("fluxer_thread_links")
			.values((mappingSeed.threads as SeedThread[]).map(thread => ({
				discord_thread_id: thread.discordThreadId,
				fluxer_thread_id: thread.fluxerThreadId,
				discord_parent_id: thread.discordParentId,
				fluxer_parent_id: thread.fluxerParentId,
				channel_kind: thread.channelKind,
				relay_enabled: thread.relayEnabled ? 1 : 0,
				updated_at_ms: updatedAt,
			})))
			.onConflict(oc =>
				oc.column("discord_thread_id").doUpdateSet(eb => ({
					fluxer_thread_id: eb.ref("excluded.fluxer_thread_id"),
					discord_parent_id: eb.ref("excluded.discord_parent_id"),
					fluxer_parent_id: eb.ref("excluded.fluxer_parent_id"),
					channel_kind: eb.ref("excluded.channel_kind"),
					relay_enabled: eb.ref("excluded.relay_enabled"),
					updated_at_ms: eb.ref("excluded.updated_at_ms"),
				}))
			)
			.execute();
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
		this.discordBot.discord.on("threadUpdate", (_oldThread, thread) => {
			this.enqueue(`discord:${thread.id}`, () => this.relayDiscordThreadUpdate(thread));
		});
		this.discordBot.discord.on("threadDelete", thread => {
			this.enqueue(`discord:${thread.id}`, () => this.relayDiscordThreadDelete(thread));
		});
	}

	private async relayDiscordThreadUpdate(thread: Discord.AnyThreadChannel) {
		const link = this.threadLinksByDiscord.get(thread.id);
		if (!link) return;
		const body: Record<string, unknown> = { name: thread.name.slice(0, 100) };
		if (thread.archived) body.archived = true;
		await this.rest.request("PATCH", `/channels/${link.fluxer_thread_id}`, body).catch(error =>
			log.warn(
				{
					err: error,
					discordThreadId: thread.id,
					fluxerThreadId: link.fluxer_thread_id,
				},
				"Discord->Fluxer thread update failed"
			)
		);
	}

	private async relayDiscordThreadDelete(thread: Discord.AnyThreadChannel) {
		const link = this.threadLinksByDiscord.get(thread.id);
		if (!link) return;
		await this.rest.request("DELETE", `/channels/${link.fluxer_thread_id}`).catch(error => {
			if (!(error instanceof FluxerApiError) || error.status !== 404) {
				log.warn(
					{
						err: error,
						discordThreadId: thread.id,
						fluxerThreadId: link.fluxer_thread_id,
					},
					"Discord->Fluxer thread delete failed"
				);
			}
		});
		await this.deleteThreadLink(link);
	}

	private relayFailure(op: string, context: Record<string, unknown>, error: unknown): never {
		log.error({ err: error, relay: op, ...context }, "Fluxer relay operation failed");
		throw error;
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

	private routeForThreadLink(link: ThreadLink): ChannelRoute {
		return {
			discordChannelId: link.discord_thread_id,
			fluxerChannelId: link.fluxer_thread_id,
			discordParentId: link.discord_parent_id,
			fluxerParentId: link.fluxer_parent_id,
			channelKind: link.channel_kind,
			relayEnabled: link.relay_enabled === 1,
		};
	}

	private routeByDiscordChannel(channelId: string): ChannelRoute | undefined {
		const route = this.routesByDiscord.get(channelId);
		if (route) return route;
		const link = this.threadLinksByDiscord.get(channelId);
		return link ? this.routeForThreadLink(link) : undefined;
	}

	private routeByFluxerChannel(channelId: string): ChannelRoute | undefined {
		const route = this.routesByFluxer.get(channelId);
		if (route) return route;
		const link = this.threadLinksByFluxer.get(channelId);
		return link ? this.routeForThreadLink(link) : undefined;
	}

	private isThreadDestination(route: ChannelRoute) {
		return route.channelKind === "thread" || route.channelKind === "forum_post";
	}

	// Native Fluxer threads live in a parent channel; legacy routes pointed at a stand-in channel.
	private isNativeFluxerThread(route: ChannelRoute) {
		return this.isThreadDestination(route) && Boolean(route.fluxerParentId);
	}

	private isDiscordForumLike(channel: Discord.Channel) {
		return (
			channel.type === Discord.ChannelType.GuildForum ||
			channel.type === Discord.ChannelType.GuildMedia
		);
	}

	private async saveThreadLink(link: ThreadLink) {
		this.threadLinksByDiscord.set(link.discord_thread_id, link);
		this.threadLinksByFluxer.set(link.fluxer_thread_id, link);
		await this.localDB.db
			.insertInto("fluxer_thread_links")
			.values({
				discord_thread_id: link.discord_thread_id,
				fluxer_thread_id: link.fluxer_thread_id,
				discord_parent_id: link.discord_parent_id,
				fluxer_parent_id: link.fluxer_parent_id,
				channel_kind: link.channel_kind,
				relay_enabled: link.relay_enabled,
				updated_at_ms: Date.now(),
			})
			.onConflict(oc =>
				oc.column("discord_thread_id").doUpdateSet(eb => ({
					fluxer_thread_id: eb.ref("excluded.fluxer_thread_id"),
					discord_parent_id: eb.ref("excluded.discord_parent_id"),
					fluxer_parent_id: eb.ref("excluded.fluxer_parent_id"),
					channel_kind: eb.ref("excluded.channel_kind"),
					relay_enabled: eb.ref("excluded.relay_enabled"),
					updated_at_ms: eb.ref("excluded.updated_at_ms"),
				}))
			)
			.execute();
	}

	private async deleteThreadLink(link: ThreadLink) {
		this.threadLinksByDiscord.delete(link.discord_thread_id);
		this.threadLinksByFluxer.delete(link.fluxer_thread_id);
		await this.localDB.db
			.deleteFrom("fluxer_thread_links")
			.where("discord_thread_id", "=", link.discord_thread_id)
			.execute();
	}

	private async fetchFluxerChannel(channelId: string) {
		try {
			return await this.rest.request<FluxerThreadChannel>("GET", `/channels/${channelId}`);
		} catch (error) {
			if (error instanceof FluxerApiError && error.status === 404) return;
			throw error;
		}
	}

	private fluxerWebhookPath(webhook: FluxerWebhook, route: ChannelRoute, wait = true) {
		const params = new URLSearchParams();
		if (wait) params.set("wait", "true");
		if (this.isNativeFluxerThread(route)) params.set("thread_id", route.fluxerChannelId);
		return `/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}?${params.toString()}`;
	}

	private fluxerWebhookMessagePath(
		webhook: FluxerWebhook,
		route: ChannelRoute,
		messageId: string
	) {
		const params = new URLSearchParams();
		if (this.isNativeFluxerThread(route)) params.set("thread_id", route.fluxerChannelId);
		const query = params.toString();
		return `/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}/messages/${messageId}${query ? `?${query}` : ""}`;
	}

	// Attachments for a thread message are claimed against the webhook's channel, not the thread.
	private fluxerWebhookChannelId(route: ChannelRoute) {
		return this.isNativeFluxerThread(route)
			? (route.fluxerParentId ?? route.fluxerChannelId)
			: route.fluxerChannelId;
	}

	// A message in a native Fluxer thread whose Discord counterpart does not exist yet.
	private async resolveFluxerThreadRoute(
		message: FluxerMessage
	): Promise<ThreadResolution | undefined> {
		const channel = await this.fetchFluxerChannel(message.channel_id);
		if (!channel) return undefined;
		const parentId = message._fluxer_thread?.parent_id ?? channel.parent_id ?? undefined;
		if (!parentId) return undefined;
		const parentRoute = this.routesByFluxer.get(parentId);
		if (!parentRoute?.relayEnabled) return undefined;
		const parentChannel = await this.discordBot.discord.channels.fetch(
			parentRoute.discordChannelId
		);
		if (!parentChannel) return undefined;
		const name = (channel.name ?? "thread").slice(0, 100);
		const link: ThreadLink = {
			discord_thread_id: "",
			fluxer_thread_id: message.channel_id,
			discord_parent_id: parentRoute.discordChannelId,
			fluxer_parent_id: parentId,
			channel_kind: this.isDiscordForumLike(parentChannel) ? "forum_post" : "thread",
			relay_enabled: 1,
		};
		if (link.channel_kind === "thread") {
			if (
				parentChannel.type !== Discord.ChannelType.GuildText &&
				parentChannel.type !== Discord.ChannelType.GuildAnnouncement
			) {
				return undefined;
			}
			const archiveDuration = channel.thread_metadata?.auto_archive_duration;
			const thread = await parentChannel.threads.create({
				name,
				...((archiveDuration === 60 ||
				archiveDuration === 1440 ||
				archiveDuration === 4320 ||
				archiveDuration === 10_080
					? { autoArchiveDuration: archiveDuration }
					: {}) as { autoArchiveDuration?: Discord.ThreadAutoArchiveDuration }),
			});
			link.discord_thread_id = thread.id;
			if (channel.thread_metadata?.archived) {
				await thread.setArchived(true).catch(() => undefined);
			}
			await this.saveThreadLink(link);
			return { route: this.routeForThreadLink(link), handled: false };
		}
		// Forum post: the triggering message becomes the starter, sent via the forum webhook.
		const destination = await this.getDiscordWebhook(parentRoute);
		const forumChannel = parentChannel as Discord.ForumChannel | Discord.MediaChannel;
		const fluxerParent = await this.fetchFluxerChannel(parentId);
		const nameByFluxerTag = new Map(
			(fluxerParent?.available_tags ?? []).map(tag => [tag.id, tag.name])
		);
		const appliedTags = (channel.applied_tags ?? [])
			.map(id => nameByFluxerTag.get(id))
			.map(name =>
				name ? forumChannel.availableTags.find(tag => tag.name === name)?.id : undefined
			)
			.filter((id): id is string => Boolean(id))
			.slice(0, 5);
		const payload = this.translateFluxerMessage(message);
		const { files, fallbackUrls } = await this.prepareDiscordAttachments(
			message.attachments ?? []
		);
		payload.content = await this.fluxerReplyContent(message, payload.content, fallbackUrls);
		const embeds = normalizeEmbeds(message.embeds ?? [], message.content);
		const sent = await destination.webhook
			.send({
				content: payload.content || undefined,
				username: this.fluxerDisplayName(message).slice(0, 80),
				avatarURL: this.fluxerAvatarUrl(message),
				...((embeds.length > 0) && { embeds }),
				files,
				threadName: name,
				...((appliedTags.length > 0) && { appliedTags }),
				allowedMentions: {
					parse: [],
					users: payload.users,
					roles: payload.roles,
					repliedUser: false,
				},
			})
			.catch(error =>
				this.relayFailure(
					"fluxer->discord forum post create",
					{
						fluxerMessageId: message.id,
						fluxerChannelId: message.channel_id,
						discordChannelId: parentRoute.discordChannelId,
					},
					error
				)
			);
		link.discord_thread_id = sent.channelId;
		await this.saveThreadLink(link);
		const route = this.routeForThreadLink(link);
		await this.saveMessageMapping(sent.id, message.id, route, "fluxer");
		return { route, handled: true };
	}

	// A message in a native Discord thread whose Fluxer counterpart does not exist yet.
	private async resolveDiscordThreadRoute(
		message: Discord.Message
	): Promise<ThreadResolution | undefined> {
		const threadChannel = message.channel;
		if (!threadChannel.isThread()) return undefined;
		const parentId = threadChannel.parentId;
		if (!parentId) return undefined;
		const parentRoute = this.routesByDiscord.get(parentId);
		if (!parentRoute?.relayEnabled) return undefined;
		const parentChannel =
			threadChannel.parent ??
			(await this.discordBot.discord.channels.fetch(parentId).catch(() => null));
		const isForum = parentChannel && this.isDiscordForumLike(parentChannel);
		const link: ThreadLink = {
			discord_thread_id: threadChannel.id,
			fluxer_thread_id: "",
			discord_parent_id: parentId,
			fluxer_parent_id: parentRoute.fluxerChannelId,
			channel_kind: isForum ? "forum_post" : "thread",
			relay_enabled: 1,
		};
		if (isForum) {
			const payload = await this.translateDiscordMessage(message);
			const { attachments, fallbackUrls } = await this.prepareFluxerAttachments(parentRoute, message.attachments.values().toArray());
			payload.content = appendContent(payload.content, fallbackUrls, 4000);
			const embeds = normalizeEmbeds(
				message.embeds.map(embed => embed.toJSON()),
				message.content
			);
			const forumChannel = parentChannel;
			const fluxerParent = await this.fetchFluxerChannel(parentRoute.fluxerChannelId);
			const fluxerTagByName = new Map(
				(fluxerParent?.available_tags ?? []).map(tag => [tag.name, tag.id])
			);
			const appliedTags = threadChannel.appliedTags
				.map(id => forumChannel.availableTags.find(tag => tag.id === id)?.name)
				.map(name => (name ? fluxerTagByName.get(name) : undefined))
				.filter((id): id is string => Boolean(id))
				.slice(0, 5);
			const sent = await this.withFluxerWebhook(parentRoute, webhook =>
				this.rest.requestRequireResponse<FluxerMessage>(
					"POST",
					`/webhooks/${webhook.id}/${encodeURIComponent(webhook.token)}?wait=true`,
					{
						content: payload.content || null,
						thread_name: threadChannel.name.slice(0, 100),
						...((appliedTags.length > 0) && { applied_tags: appliedTags }),
						username: (message.member?.displayName ?? message.author.displayName).slice(
							0,
							80
						),
						avatar_url: message.author.displayAvatarURL({ size: 128 }),
						...((embeds.length > 0) && { embeds }),
						...((attachments.length > 0) && { attachments }),
						allowed_mentions: {
							parse: [],
							users: payload.users,
							roles: payload.roles,
							replied_user: false,
						},
					},
					false,
					true
				)
			).catch(error =>
				this.relayFailure(
					"discord->fluxer forum post create",
					{
						discordMessageId: message.id,
						discordChannelId: message.channelId,
						fluxerChannelId: parentRoute.fluxerChannelId,
					},
					error
				)
			);
			link.fluxer_thread_id = sent.channel_id;
			await this.saveThreadLink(link);
			const route = this.routeForThreadLink(link);
			await this.saveMessageMapping(message.id, sent.id, route, "discord");
			return { route, handled: true };
		}
		const fluxerType = threadChannel.type === Discord.ChannelType.PrivateThread ? 12 : 11;
		const created = await this.rest
			.requestRequireResponse<FluxerThreadChannel>(
				"POST",
				`/channels/${parentRoute.fluxerChannelId}/threads`,
				{
					name: threadChannel.name.slice(0, 100),
					type: fluxerType,
					...(threadChannel.autoArchiveDuration && { auto_archive_duration: threadChannel.autoArchiveDuration }),
					...((threadChannel.type === Discord.ChannelType.PrivateThread) && { invitable: threadChannel.invitable ?? true }),
				},
				true,
				true
			)
			.catch(error =>
				this.relayFailure(
					"discord->fluxer thread create",
					{
						discordMessageId: message.id,
						discordChannelId: message.channelId,
						fluxerChannelId: parentRoute.fluxerChannelId,
					},
					error
				)
			);
		link.fluxer_thread_id = created.id;
		await this.saveThreadLink(link);
		return { route: this.routeForThreadLink(link), handled: false };
	}

	private async relayDiscordCreate(message: Discord.Message | Discord.PartialMessage) {
		if (!config.enabled || message.guildId !== this.discordBot.config.bot.primaryGuildId)
			return;
		if (message.webhookId && this.discordBridgeWebhookIds.has(message.webhookId)) return;
		let route = this.routeByDiscordChannel(message.channelId);
		let handled = false;
		if (!route && message.channel.isThread()) {
			if (message.partial) message = await message.fetch();
			const resolution = await this.resolveDiscordThreadRoute(message);
			if (!resolution) return;
			route = resolution.route;
			handled = resolution.handled;
		}
		if (!route?.relayEnabled || (await this.mappingByDiscordMessage(message.id))) return;
		if (message.partial) message = await message.fetch();
		if (handled) return;
		if (message.reference?.type === Discord.MessageReferenceType.Forward) {
			await this.relayDiscordForward(message, route);
			return;
		}
		if (message.system) return;
		const payload = await this.translateDiscordMessage(message);
		const voiceAttachment =
			message.flags.has(Discord.MessageFlags.IsVoiceMessage) &&
			message.attachments.size === 1 &&
			message.attachments.first()?.duration &&
			message.attachments.first()?.waveform
				? message.attachments.first()
				: undefined;
		const { attachments, fallbackUrls } = await this.prepareFluxerAttachments(route, message.attachments.values().toArray());
		const voiceMessage = voiceAttachment && attachments.length === 1;
		const stickerIds = message.stickers.values()
			.map(sticker => this.stickerFluxerByDiscord.get(sticker.id))
			.filter((id): id is string => Boolean(id))
			.take(3)
			.toArray();
		const fallbackStickerUrls = message.stickers.values()
			.filter(sticker => !this.stickerFluxerByDiscord.has(sticker.id))
			.map(sticker => sticker.url)
			.toArray();
		payload.content = appendContent(
			payload.content,
			fallbackStickerUrls.concat(fallbackUrls),
			4000
		);
		const components = message.components.map(component => component.toJSON());
		const embeds = voiceMessage
			? []
			: normalizeEmbeds(
				[
					...message.embeds.map(embed => embed.toJSON()),
					...componentEmbeds(components),
				],
				message.content
			);
		if (!voiceMessage && !payload.content && embeds.length === 0 && attachments.length === 0) {
			payload.content =
				componentFallbackText(components).slice(0, 4000) ||
				`[View this Discord message](${message.url})`;
		}
		const reply = message.reference?.messageId
			? await this.mappingByDiscordMessage(message.reference.messageId)
			: undefined;
		const sent = await this.withFluxerWebhook(route, webhook =>
			this.rest.requestRequireResponse<FluxerMessage>(
				"POST",
				this.fluxerWebhookPath(webhook, route),
				{
					content: voiceMessage ? null : payload.content || null,
					nonce: message.id,
					username: (message.member?.displayName ?? message.author.displayName).slice(
						0,
						80
					),
					avatar_url: message.author.displayAvatarURL({ size: 128 }),
					...((embeds.length > 0) && { embeds }),
					...(voiceMessage
						? {
							flags: Discord.MessageFlags.IsVoiceMessage,
							attachments: [attachments[0]],
						}
						: { attachments }),
					...(!(voiceMessage || stickerIds.length === 0) && { sticker_ids: stickerIds }),
					allowed_mentions: {
						parse: [],
						users: payload.users,
						roles: payload.roles,
						replied_user: false,
					},
					...(reply && {
						message_reference: {
							message_id: reply.fluxer_message_id,
							channel_id: reply.fluxer_channel_id,
							type: 0,
						},
					}),
				},
				false,
				true
			)
		).catch(error =>
			this.relayFailure(
				"discord->fluxer create",
				{
					discordMessageId: message.id,
					discordChannelId: message.channelId,
					fluxerChannelId: route.fluxerChannelId,
					hasReply: Boolean(reply),
					embedCount: embeds.length,
					attachmentCount: attachments.length,
				},
				error
			)
		);
		await this.saveMessageMapping(message.id, sent.id, route, "discord");
	}

	private async relayDiscordForward(message: Discord.Message, route: ChannelRoute) {
		const snapshot = message.messageSnapshots.first();
		const sourceMapping = message.reference?.messageId
			? await this.mappingByDiscordMessage(message.reference.messageId)
			: undefined;
		if (sourceMapping) {
			// The source is bridged, so create a native Fluxer forward that references it.
			try {
				const sent = await this.withFluxerWebhook(route, webhook =>
					this.rest.requestRequireResponse<FluxerMessage>(
						"POST",
						this.fluxerWebhookPath(webhook, route),
						{
							nonce: message.id,
							username: (
								message.member?.displayName ?? message.author.displayName
							).slice(0, 80),
							avatar_url: message.author.displayAvatarURL({ size: 128 }),
							message_reference: {
								message_id: sourceMapping.fluxer_message_id,
								channel_id: sourceMapping.fluxer_channel_id,
								type: FLUXER_FORWARD_REFERENCE_TYPE,
							},
						},
						false,
						true
					)
				);
				await this.saveMessageMapping(message.id, sent.id, route, "discord");
				return;
			} catch (error) {
				if (!(error instanceof FluxerApiError)) {
					this.relayFailure(
						"discord->fluxer forward create",
						{
							discordMessageId: message.id,
							discordChannelId: message.channelId,
							fluxerChannelId: route.fluxerChannelId,
							sourceFluxerMessageId: sourceMapping.fluxer_message_id,
						},
						error
					);
				}
				log.warn(
					{ err: error, discordMessageId: message.id },
					"Fluxer native forward failed; falling back to snapshot relay"
				);
			}
		}
		// The source is not on Fluxer; relay the snapshot contents as a regular message.
		const payload = await this.translateDiscordMessage({
			...message,
			content: snapshot?.content ?? "",
			mentions: snapshot?.mentions ?? message.mentions,
		} as unknown as Discord.Message);
		const { attachments, fallbackUrls } = await this.prepareFluxerAttachments(
			route,
			snapshot ? snapshot.attachments.values().toArray() : []
		);
		const snapshotStickers = snapshot?.stickers.values() ?? [];
		const stickerIds = [...snapshotStickers]
			.map(sticker => this.stickerFluxerByDiscord.get(sticker.id))
			.filter((id): id is string => Boolean(id))
			.slice(0, 3);
		const fallbackStickerUrls = [...snapshotStickers]
			.filter(sticker => !this.stickerFluxerByDiscord.has(sticker.id))
			.map(sticker => sticker.url);
		payload.content = appendContent(
			payload.content,
			fallbackStickerUrls.concat(fallbackUrls),
			4000
		);
		const snapshotComponents = (snapshot?.components.map(component => component.toJSON()) ??
			[]) as unknown[];
		const embeds = normalizeEmbeds(
			[
				...(snapshot?.embeds.map(embed => embed.toJSON()) ?? []),
				...componentEmbeds(snapshotComponents),
			],
			payload.content
		);
		const header = `[Forwarded message from Discord](<${message.url}>)`;
		if (!payload.content && embeds.length === 0 && attachments.length === 0) {
			payload.content = `[View this Discord message](<${message.url}>)`;
		} else if (payload.content || fallbackStickerUrls.length > 0) {
			payload.content = appendContent(header, [payload.content], 4000);
		}
		await this.withFluxerWebhook(route, webhook =>
			this.rest.requestRequireResponse<FluxerMessage>(
				"POST",
				this.fluxerWebhookPath(webhook, route),
				{
					content: payload.content || null,
					nonce: message.id,
					username: (message.member?.displayName ?? message.author.displayName).slice(
						0,
						80
					),
					avatar_url: message.author.displayAvatarURL({ size: 128 }),
					...((embeds.length > 0) && { embeds }),
					attachments,
					...((stickerIds.length > 0) && { sticker_ids: stickerIds }),
					allowed_mentions: {
						parse: [],
						users: payload.users,
						roles: payload.roles,
						replied_user: false,
					},
				},
				false,
				true
			)
		)
			.then(sent => this.saveMessageMapping(message.id, sent.id, route, "discord"))
			.catch(error =>
				this.relayFailure(
					"discord->fluxer forward fallback",
					{
						discordMessageId: message.id,
						discordChannelId: message.channelId,
						fluxerChannelId: route.fluxerChannelId,
						embedCount: embeds.length,
						attachmentCount: attachments.length,
					},
					error
				)
			);
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
			for (const message of messages.values().toArray().toSorted(
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
		const route = mapping ? this.routeByDiscordChannel(mapping.discord_channel_id) : undefined;
		if (!mapping || mapping.origin !== "discord" || !route?.relayEnabled) return;
		if (message.partial) message = await message.fetch();
		const payload = await this.translateDiscordMessage(message);
		payload.content = appendContent(
			payload.content,
			message.stickers.values().map(sticker => sticker.url).toArray(),
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
		if (
			!payload.content &&
			embeds.length === 0 &&
			(message.attachments.size > 0 || message.stickers.size > 0)
		) {
			return;
		}
		await this.withFluxerWebhook(route, webhook =>
			this.rest.request(
				"PATCH",
				this.fluxerWebhookMessagePath(webhook, route, mapping.fluxer_message_id),
				{
					content: payload.content || null,
					...((embeds.length > 0) && { embeds }),
					allowed_mentions: {
						parse: [],
						users: payload.users,
						roles: payload.roles,
						replied_user: false,
					},
				},
				false
			)
		).catch(error =>
			this.relayFailure(
				"discord->fluxer update",
				{
					discordMessageId: mapping.discord_message_id,
					discordChannelId: mapping.discord_channel_id,
					fluxerMessageId: mapping.fluxer_message_id,
					fluxerChannelId: mapping.fluxer_channel_id,
				},
				error
			)
		);
	}

	private async relayDiscordDelete(messageId: string) {
		if (!config.enabled) return;
		if (this.suppressedDiscordDeletes.delete(messageId)) return;
		const mapping = await this.mappingByDiscordMessage(messageId);
		const route = mapping ? this.routeByDiscordChannel(mapping.discord_channel_id) : undefined;
		if (!mapping || !route?.relayEnabled) return;
		this.suppress(this.suppressedFluxerDeletes, mapping.fluxer_message_id);
		try {
			if (mapping.origin === "discord") {
				await this.withFluxerWebhook(route, webhook =>
					this.rest.request(
						"DELETE",
						this.fluxerWebhookMessagePath(webhook, route, mapping.fluxer_message_id),
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
			if (!(error instanceof FluxerApiError) || error.status !== 404) {
				this.relayFailure(
					"discord->fluxer delete",
					{
						discordMessageId: mapping.discord_message_id,
						discordChannelId: mapping.discord_channel_id,
						fluxerMessageId: mapping.fluxer_message_id,
						fluxerChannelId: mapping.fluxer_channel_id,
						origin: mapping.origin,
					},
					error
				);
			}
		}
		await this.deleteMessageMapping(mapping);
	}

	private async handleFluxerDispatch(event: string, data: unknown) {
		switch (event) {
			case "MESSAGE_CREATE": {
				const message = data as FluxerMessage;
				if (message.guild_id !== config.guildId) return;
				if (await this.handleLinkCommand(message)) return;
				await this.relayFluxerCreate(message);
				break;
			}
			case "MESSAGE_UPDATE": {
				await this.relayFluxerUpdate(data as FluxerMessage);
				break;
			}
			case "MESSAGE_DELETE": {
				const message = data as { id: string; channel_id: string };
				await this.relayFluxerDelete(message.id);
				break;
			}
			case "MESSAGE_DELETE_BULK": {
				const payload = data as { ids: string[] };
				for (const id of payload.ids) await this.relayFluxerDelete(id);
				break;
			}
			case "THREAD_UPDATE": {
				await this.relayFluxerThreadUpdate(data as FluxerThreadChannel);
				break;
			}
			case "THREAD_DELETE": {
				await this.relayFluxerThreadDelete(data as { id: string });
				break;
			}
		}
	}

	private async relayFluxerThreadUpdate(thread: FluxerThreadChannel) {
		const link = this.threadLinksByFluxer.get(thread.id);
		if (!link) return;
		const channel = await this.discordBot.discord.channels
			.fetch(link.discord_thread_id)
			.catch(() => null);
		if (!channel?.isThread()) return;
		if (thread.name && channel.name !== thread.name) {
			await channel.setName(thread.name.slice(0, 100)).catch(() => undefined);
		}
		if (thread.thread_metadata?.archived && !channel.archived) {
			await channel.setArchived(true).catch(() => undefined);
		}
	}

	private async relayFluxerThreadDelete(payload: { id: string }) {
		const link = this.threadLinksByFluxer.get(payload.id);
		if (!link) return;
		const channel = await this.discordBot.discord.channels
			.fetch(link.discord_thread_id)
			.catch(() => null);
		if (channel?.isThread()) {
			await channel.delete().catch(() => undefined);
		}
		await this.deleteThreadLink(link);
	}

	private async relayFluxerCreate(message: FluxerMessage) {
		if (message.guild_id !== config.guildId) return;
		if (message.type !== 0 && message.type !== 19) return;
		if (message.author.id === config.applicationId) return;
		if (message.webhook_id && this.fluxerBridgeWebhookIds.has(message.webhook_id)) return;
		let route = this.routeByFluxerChannel(message.channel_id);
		let handled = false;
		if (
			!route &&
			(FLUXER_THREAD_TYPES.has(message.channel_type ?? -1) || message._fluxer_thread)
		) {
			const resolution = await this.resolveFluxerThreadRoute(message);
			if (!resolution) return;
			route = resolution.route;
			handled = resolution.handled;
		}
		if (!route?.relayEnabled || (await this.mappingByFluxerMessage(message.id))) return;
		if (handled) return;
		if (isFluxerForward(message)) {
			await this.relayFluxerForward(message, route);
			return;
		}
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
		const sent = await destination.webhook
			.send({
				content: payload.content || undefined,
				username: this.fluxerDisplayName(message).slice(0, 80),
				avatarURL: this.fluxerAvatarUrl(message),
				...((embeds.length > 0) && { embeds }),
				files,
				allowedMentions: {
					parse: [],
					users: payload.users,
					roles: payload.roles,
					repliedUser: false,
				},
				...(destination.threadId && { threadId: destination.threadId }),
			})
			.catch(error =>
				this.relayFailure(
					"fluxer->discord create",
					{
						fluxerMessageId: message.id,
						fluxerChannelId: message.channel_id,
						discordChannelId: route.discordChannelId,
						isThread: route.channelKind === "thread",
						attachmentCount: files.length,
						embedCount: embeds.length,
					},
					error
				)
			);
		await this.saveMessageMapping(sent.id, message.id, route, "fluxer");
	}

	private async relayFluxerForward(message: FluxerMessage, route: ChannelRoute) {
		const snapshot = message.message_snapshots?.[0];
		const reference = message.message_reference;
		const header = reference?.message_id
			? `> Forwarded message: ${config.webAppBaseUrl}/channels/${config.guildId}/${reference.channel_id}/${reference.message_id}`
			: "> Forwarded message:";
		const payload = this.translateFluxerMessage({
			...message,
			content: snapshot?.content ?? "",
			mentions: snapshot ? fluxerSnapshotMentions(snapshot) : message.mentions,
		});
		const snapshotStickers = snapshot?.stickers ?? [];
		payload.content = appendContent(
			payload.content,
			snapshotStickers.map(sticker => `${config.mediaBaseUrl}/stickers/${sticker.id}.png`),
			2000
		);
		const { files, fallbackUrls } = await this.prepareDiscordAttachments(
			snapshot?.attachments ?? []
		);
		const embeds = normalizeEmbeds(snapshot?.embeds ?? [], snapshot?.content ?? "");
		const destination = await this.getDiscordWebhook(route);
		const sent = await destination.webhook
			.send({
				content: appendContent(header, [payload.content, ...fallbackUrls], 2000),
				username: this.fluxerDisplayName(message).slice(0, 80),
				avatarURL: this.fluxerAvatarUrl(message),
				...((embeds.length > 0) && { embeds }),
				files,
				allowedMentions: {
					parse: [],
					users: payload.users,
					roles: payload.roles,
					repliedUser: false,
				},
				...(destination.threadId && { threadId: destination.threadId }),
			})
			.catch(error =>
				this.relayFailure(
					"fluxer->discord forward create",
					{
						fluxerMessageId: message.id,
						fluxerChannelId: message.channel_id,
						discordChannelId: route.discordChannelId,
						isThread: route.channelKind === "thread",
						attachmentCount: files.length,
						embedCount: embeds.length,
					},
					error
				)
			);
		await this.saveMessageMapping(sent.id, message.id, route, "fluxer");
	}

	private async relayFluxerUpdate(message: FluxerMessage) {
		if (!config.enabled) return;
		if (message.webhook_id && this.fluxerBridgeWebhookIds.has(message.webhook_id)) return;
		const mapping = await this.mappingByFluxerMessage(message.id);
		if (!mapping || mapping.origin !== "fluxer") return;
		if (isFluxerForward(message)) return;
		const route = this.routeByFluxerChannel(mapping.fluxer_channel_id);
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
		await destination.webhook
			.editMessage(mapping.discord_message_id, {
				content: payload.content || null,
				...((embeds.length > 0) && { embeds }),
				attachments: [],
				files,
				allowedMentions: {
					parse: [],
					users: payload.users,
					roles: payload.roles,
					repliedUser: false,
				},
				...(destination.threadId && { threadId: destination.threadId }),
			})
			.catch(error =>
				this.relayFailure(
					"fluxer->discord update",
					{
						fluxerMessageId: message.id,
						fluxerChannelId: message.channel_id,
						discordMessageId: mapping.discord_message_id,
						discordChannelId: mapping.discord_channel_id,
						isThread: route.channelKind === "thread",
					},
					error
				)
			);
	}

	private async relayFluxerDelete(messageId: string) {
		if (!config.enabled) return;
		if (this.suppressedFluxerDeletes.delete(messageId)) return;
		const mapping = await this.mappingByFluxerMessage(messageId);
		if (!mapping) return;
		const route = this.routeByFluxerChannel(mapping.fluxer_channel_id);
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
			if ((error as { code?: number }).code !== 10_008) {
				this.relayFailure(
					"fluxer->discord delete",
					{
						fluxerMessageId: mapping.fluxer_message_id,
						fluxerChannelId: mapping.fluxer_channel_id,
						discordMessageId: mapping.discord_message_id,
						discordChannelId: mapping.discord_channel_id,
						origin: mapping.origin,
					},
					error
				);
			}
		}
		await this.deleteMessageMapping(mapping);
	}

	private isStaleDiscordCdnUrl(url: string): boolean {
		const signature = /[?&]hm=/.exec(url);
		if (!signature) return true;
		const expiry = /[?&]ex=([0-9a-f]+)/i.exec(url);
		if (!expiry) return true;
		const expiresAt = Number.parseInt(expiry[1], 16) * 1000;
		return !Number.isFinite(expiresAt) || expiresAt <= Date.now() + 60_000;
	}

	private async refreshDiscordCdnUrls(content: string): Promise<string> {
		const urls = new Set<string>();
		for (const match of content.matchAll(DISCORD_ATTACHMENT_CDN)) {
			const url = match[0].replace(/[.,;!]+$/, "");
			if (this.isStaleDiscordCdnUrl(url)) urls.add(url);
		}
		if (urls.size === 0) return content;
		const requested = [...urls].slice(0, MAX_REFRESH_URLS);
		try {
			const response = await fetch(`${DISCORD_API_BASE}/attachments/refresh-urls`, {
				method: "POST",
				headers: {
					Authorization: `Bot ${this.discordBot.config.bot.token}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({ attachment_urls: requested }),
				signal: AbortSignal.timeout(15_000),
			});
			if (!response.ok) {
				log.warn({ status: response.status }, "Discord attachment refresh request failed");
				return content;
			}
			const data = (await response.json()) as {
				refreshed_urls?: { original: string; refreshed: string | null }[];
			};
			const refreshed = new Map<string, string>();
			for (const entry of data.refreshed_urls ?? []) {
				if (entry.refreshed && entry.refreshed !== entry.original) {
					refreshed.set(entry.original, entry.refreshed);
				}
			}
			if (refreshed.size === 0) return content;
			return content.replaceAll(DISCORD_ATTACHMENT_CDN, match => {
				const stripped = match.replace(/[.,;!]+$/, "");
				const suffix = match.slice(stripped.length);
				return `${refreshed.get(stripped) ?? stripped}${suffix}`;
			});
		} catch (error) {
			log.warn({ err: error }, "Discord attachment refresh failed");
			return content;
		}
	}

	private async translateDiscordMessage(message: Discord.Message): Promise<MentionPayload> {
		const users = new Set<string>();
		const roles = new Set<string>();
		const emojiFallbackById = new Map<string, UnmappedEmoji>();
		let content = message.content
			.replaceAll(/<@&(\d+)>/g, (_match, id) => {
				const mapped = this.fluxerRolesByDiscord.get(id);
				if (mapped) {
					if (message.mentions.roles.has(id)) roles.add(mapped);
					return `<@&${mapped}>`;
				}
				return `@${message.guild?.roles.cache.get(id)?.name ?? "role"}`;
			})
			.replaceAll(/<@!?(\d+)>/g, (_match, id) => {
				const mapped = this.fluxerUsersByDiscord.get(id);
				if (mapped) {
					if (message.mentions.users.has(id)) users.add(mapped);
					return `<@${mapped}>`;
				}
				return `@${message.mentions.users.get(id)?.displayName ?? "user"}`;
			})
			.replaceAll(/<#(\d+)>/g, (_match, id) => {
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
				emojiFallbackById.values()
					.map(emoji => discordEmojiCdnUrl(emoji.id, emoji.animated))
					.toArray(),
				4000
			);
		}
		content = content.replaceAll(
			/https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)(?:\/(\d+))?/g,
			(match, _guildId, channelId, messageId) => {
				if (messageId) return match;
				const route = this.routesByDiscord.get(channelId);
				if (!route) return match;
				return `${config.webAppBaseUrl}/channels/${config.guildId}/${route.fluxerChannelId}`;
			}
		);
		content = await this.refreshDiscordCdnUrls(content);
		return { content, users: [...users].slice(0, 100), roles: [...roles].slice(0, 100) };
	}

	private translateFluxerMessage(message: FluxerMessage): MentionPayload {
		const users = new Set<string>();
		const roles = new Set<string>();
		let content = message.content
			.replaceAll(/<@&(\d+)>/g, (_match, id) => {
				const mapped = this.discordRolesByFluxer.get(id);
				if (mapped) {
					if (message.mention_roles.includes(id)) roles.add(mapped);
					return `<@&${mapped}>`;
				}
				return "@role";
			})
			.replaceAll(/<@!?(\d+)>/g, (_match, id) => {
				const mapped = this.discordUsersByFluxer.get(id);
				if (mapped) {
					if (message.mentions.some(user => user.id === id)) users.add(mapped);
					return `<@${mapped}>`;
				}
				const user = message.mentions.find(item => item.id === id);
				return `@${user?.global_name ?? user?.username ?? "user"}`;
			})
			.replaceAll(/<#(\d+)>/g, (_match, id) => {
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
				...((typeof attachment.duration === "number") && { duration: Math.round(attachment.duration) }),
				...(attachment.waveform && { waveform: attachment.waveform }),
			});
		}
		try {
			return {
				attachments: await this.rest.uploadAttachments(
					this.fluxerWebhookChannelId(route),
					files
				),
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
				...((typeof attachment.duration === "number") && { duration: attachment.duration }),
				...(attachment.waveform && { waveform: attachment.waveform }),
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
				const webhooks = await this.rest.requestRequireResponse<FluxerWebhook[]>(
					"GET",
					`/channels/${channelId}/webhooks`
				);
				let webhook = webhooks.find(
					item =>
						item.name === config.webhookName && item.user.id === config.applicationId
				);
				if (!webhook) {
					webhook = await this.rest.requestRequireResponse<FluxerWebhook>(
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
		route: ChannelRoute,
		operation: (webhook: FluxerWebhook) => Promise<T>
	) {
		const channelId = this.fluxerWebhookChannelId(route);
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
		const isThreadDestination = this.isThreadDestination(route);
		const webhookChannelId = isThreadDestination
			? route.discordParentId!
			: route.discordChannelId;
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
					...(isThreadDestination && { threadId: route.discordChannelId }),
				};
			})();
			this.discordWebhooks.set(webhookChannelId, pending);
			pending.catch(() => this.discordWebhooks.delete(webhookChannelId));
		}
		const destination = await pending;
		return {
			webhook: destination.webhook,
			...(isThreadDestination && { threadId: route.discordChannelId }),
		};
	}

	private fluxerDisplayName(message: FluxerMessage) {
		return message.member?.nick ?? message.author.global_name ?? message.author.username;
	}

	private fluxerAvatarUrl(message: FluxerMessage) {
		if (!message.author.avatar) return;
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
		const result = await this.localDB.db.transaction().execute(async trx => {
			const code = await trx
				.deleteFrom("fluxer_link_codes")
				.where("code", "=", match[1].toUpperCase())
				.where("expires_at_ms", ">", Date.now())
				.returning("discord_user_id")
				.executeTakeFirst();
			if (!code) return;
			const previousFluxerUser = this.fluxerUsersByDiscord.get(code.discord_user_id);
			const previousDiscordUser = this.discordUsersByFluxer.get(message.author.id);
			await trx
				.deleteFrom("fluxer_user_links")
				.where(eb =>
					eb.or([
						eb("discord_user_id", "=", code.discord_user_id),
						eb("fluxer_user_id", "=", message.author.id),
					])
				)
				.execute();
			await trx
				.insertInto("fluxer_user_links")
				.values({
					discord_user_id: code.discord_user_id,
					fluxer_user_id: message.author.id,
					created_at_ms: Date.now(),
				})
				.execute();
			return { discordUserId: code.discord_user_id, previousFluxerUser, previousDiscordUser };
		});
		let response = "That link code is invalid or expired.";
		if (result) {
			if (result.previousFluxerUser)
				this.discordUsersByFluxer.delete(result.previousFluxerUser);
			if (result.previousDiscordUser)
				this.fluxerUsersByDiscord.delete(result.previousDiscordUser);
			this.fluxerUsersByDiscord.set(result.discordUserId, message.author.id);
			this.discordUsersByFluxer.set(message.author.id, result.discordUserId);
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
		return this.messageMappingsByDiscord.get(id);
	}

	private async mappingByFluxerMessage(id: string) {
		return this.messageMappingsByFluxer.get(id);
	}

	private async saveMessageMapping(
		discordMessageId: string,
		fluxerMessageId: string,
		route: ChannelRoute,
		origin: "discord" | "fluxer"
	) {
		const mapping: MessageMapping = {
			discord_message_id: discordMessageId,
			fluxer_message_id: fluxerMessageId,
			discord_channel_id: route.discordChannelId,
			fluxer_channel_id: route.fluxerChannelId,
			origin,
		};
		this.messageMappingsByDiscord.set(mapping.discord_message_id, mapping);
		this.messageMappingsByFluxer.set(mapping.fluxer_message_id, mapping);
		if (!PERMANENT_MESSAGE_CHANNELS.has(route.discordChannelId)) return;
		await this.localDB.db
			.insertInto("fluxer_message_mappings")
			.values({
				discord_message_id: mapping.discord_message_id,
				fluxer_message_id: mapping.fluxer_message_id,
				discord_channel_id: mapping.discord_channel_id,
				fluxer_channel_id: mapping.fluxer_channel_id,
				origin: mapping.origin,
				created_at_ms: Date.now(),
			})
			.onConflict(oc => oc.doNothing())
			.execute();
	}

	private async deleteMessageMapping(mapping: MessageMapping) {
		this.messageMappingsByDiscord.delete(mapping.discord_message_id);
		this.messageMappingsByFluxer.delete(mapping.fluxer_message_id);
		if (!PERMANENT_MESSAGE_CHANNELS.has(mapping.discord_channel_id)) return;
		await this.localDB.db
			.deleteFrom("fluxer_message_mappings")
			.where("discord_message_id", "=", mapping.discord_message_id)
			.execute();
	}

	private suppress(set: Set<string>, id: string) {
		set.add(id);
		setTimeout(() => set.delete(id), 30_000).unref();
	}
}

export default function FluxerProvider(container: Container): Service {
	return new Fluxer(container);
}
