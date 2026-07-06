import * as Discord from "discord.js";
import { logger } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/ReportChatRequest.json" with { type: "json" };
import responseSchema from "./structures/ReportChatResponse.json" with { type: "json" };
import { Data } from "../../Data.js";
import { QueuedReportChatResponse } from "./structures/ReportChatResponse.js";

type ReportChatRequest = import("./structures/ReportChatRequest.js").default;

const log = logger(import.meta);

export default class ReportChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	private static getReporterSteamId64(threadChannelId: string, data: Data): string | undefined {
		const threads = data.reportThreads;
		if (!threads) return undefined;
		for (const [steamId64, threadArray] of Object.entries(threads)) {
			if (threadArray.some(t => t.channelId === threadChannelId)) return steamId64;
		}
		return undefined;
	}

	private static getThread(reporterSteamId64: string, data: Data) {
		const threadArray = data.reportThreads?.[reporterSteamId64];
		if (!threadArray || !threadArray.length) return null;
		return threadArray[threadArray.length - 1];
	}

	private static isPlayerOnline(steamId64: string, server: GameServer): boolean {
		return server.status.players.some(p => p.steamId64 === steamId64);
	}

	static async initialize(server: GameServer): Promise<void> {
		const discord = server.discord;

		discord.on("messageCreate", async (msg: Discord.Message | Discord.PartialMessage) => {
			if (!server.discord.ready) return;

			try {
				if (msg.partial) msg = await msg.fetch();
			} catch {
				return;
			}

			if (msg.author?.bot || !msg.guild) return;

			if (!msg.channel?.isThread()) return;

			const parentChannelId = msg.channel.parentId;
			if (!parentChannelId || parentChannelId !== server.discord.config.channels.reports)
				return;

			const data = server.bridge.container.getService("Data");
			const reporterSteamId64 = this.getReporterSteamId64(msg.channel.id, data);
			if (!reporterSteamId64) return;

			// Extract message info similar to ChatPayload's formatDiscordMessage
			let content = msg.content;
			content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
				const ext = !animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${ext}?v=1&size=64`;
			});
			content = content.replace(
				/(https?:\/\/tenor\.com\/view\/\S+)/g,
				(_, url) => url + ".gif"
			);

			for (const [, attachment] of msg.attachments) {
				content += (content.length > 0 ? "\n" : "") + attachment.url;
			}

			if (content.length === 0 && !msg.messageSnapshots) {
				content = msg.embeds.length > 0 ? "[Embed]" : "[Something]";
			}

			const username = msg.author?.username ?? "unknown";

			if (this.isPlayerOnline(reporterSteamId64, server)) {
				await this.send({ type: "message", username, content, reporterSteamId64 }, server);
			} else {
				if (!data.reportThreads[reporterSteamId64]) {
					data.reportThreads[reporterSteamId64] = [];
				}

				let entry = data.reportThreads[reporterSteamId64].find(
					t => t.channelId === msg.channel.id
				);
				if (!entry) {
					entry = {
						channelId: msg.channel.id,
						reportedSteamId64: "",
						pendingMessages: [],
					};
					data.reportThreads[reporterSteamId64].push(entry);
				}

				entry.pendingMessages.push({ username, content });
				await data.save?.();
			}
		});
	}

	static async handle(payload: ReportChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { steamId64, content } = payload.data;
		const { discord, bridge } = server;

		if (!discord.ready) return;

		const data = bridge.container.getService("Data");
		if (!data?.reportThreads) return;

		const threadData = this.getThread(steamId64, data);
		if (!threadData || !threadData.channelId) return;

		const guild = discord.guilds.cache.get(server.bridge.config.guildId);
		if (!guild) return;

		try {
			const thread = (await guild.channels.fetch(
				threadData.channelId
			)) as Discord.ThreadChannel;
			if (!thread) return;

			const player = server.status.players.find(p => p.steamId64 === steamId64);
			const username = player?.nick ?? "Unknown";
			await thread.send({ content: `${username}: ${content}` });
		} catch (err) {
			log.error(err, "Failed to send report chat message");
		}
	}

	static async storeThread(
		reporterSteamId64: string,
		channelId: string,
		reportedSteamId64: string,
		server: GameServer
	): Promise<void> {
		const data = server.bridge.container.getService("Data");
		if (!data?.reportThreads) return;

		if (!data.reportThreads[reporterSteamId64]) {
			data.reportThreads[reporterSteamId64] = [];
		}
		data.reportThreads[reporterSteamId64].push({
			channelId,
			reportedSteamId64,
			pendingMessages: [],
		});
		await data.save?.();
	}

	static async drainQueuedMessages(server: GameServer): Promise<void> {
		const data = server.bridge.container.getService("Data");
		if (!data?.reportThreads) return;

		for (const [reporterSteamId64, threadArray] of Object.entries(data.reportThreads)) {
			if (!threadArray.length) continue;

			const isOnline = server.status.players.some(p => p.steamId64 === reporterSteamId64);
			if (!isOnline) continue;

			const messages: Array<{ username: string; content: string }> = [];
			for (let i = threadArray.length - 1; i >= 0; i--) {
				const entry = threadArray[i];
				if (!entry.pendingMessages?.length) {
					threadArray.splice(i, 1);
					continue;
				}

				messages.push(...entry.pendingMessages);
				entry.pendingMessages = [];
			}
			await data.save?.();

			if (messages.length === 0) continue;

			this.send(
				{
					type: "queued",
					messages: messages,
					reporterSteamId64: reporterSteamId64,
				} as QueuedReportChatResponse,
				server
			);
		}
	}
}
