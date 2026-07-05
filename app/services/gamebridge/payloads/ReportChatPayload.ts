import * as Discord from "discord.js";
import { logger } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import SteamID from "steamid";
import requestSchema from "./structures/ReportChatRequest.json" with { type: "json" };
import responseSchema from "./structures/ReportChatResponse.json" with { type: "json" };

type ReportChatRequest = import("./structures/ReportChatRequest.js").default;

const log = logger(import.meta);

export default class ReportChatPayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static reportThreads: {
		[reporterSteamId64: string]: {
			channelId: string;
			resolved: boolean;
			reportedSteamId64: string;
		};
	} = {};

	private static getReporterSteamId64(threadChannelId: string): string | undefined {
		for (const [steamId64, thread] of Object.entries(this.reportThreads)) {
			if (thread.channelId === threadChannelId) return steamId64;
		}
		return undefined;
	}

	private static isPlayerOnline(steamId64: string, server: GameServer): boolean {
		return server.status.players.some(
			p => new SteamID(String(p.accountId)).getSteamID64() === steamId64
		);
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

			const reporterSteamId64 = this.getReporterSteamId64(msg.channel.id);
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
				const data = server.bridge.container.getService("Data") as {
					reportQueues?: Record<string, Array<{ username: string; content: string }>>;
				};
				if (!data?.reportQueues) return;
				if (!data.reportQueues[reporterSteamId64]) {
					data.reportQueues[reporterSteamId64] = [{ username, content }];
				} else {
					data.reportQueues[reporterSteamId64].push({ username, content });
				}
			}
		});

		discord.on("interactionCreate", async (interaction: Discord.Interaction) => {
			if (!interaction.isButton()) return;

			const customId = interaction.customId;
			if (!customId.endsWith("_REPORT_RESOLVE")) return;

			if (!(await server.discord.isAllowed(interaction.user))) {
				await interaction.reply({
					content: "You're not allowed to use this button...",
					flags: Discord.MessageFlags.Ephemeral,
				});
				return;
			}

			await interaction.deferReply();

			try {
				const reporterSteamId64 = customId.replace("_REPORT_RESOLVE", "");

				if (!this.reportThreads[reporterSteamId64]) {
					await interaction.followUp({ content: "Report thread not found." });
					return;
				}

				this.reportThreads[reporterSteamId64].resolved = true;

				const resolvedBy = interaction.user.username;

				if (interaction.message) {
					try {
						await interaction.message.edit({
							components: [
								new Discord.ActionRowBuilder<Discord.ButtonBuilder>().setComponents(
									new Discord.ButtonBuilder()
										.setStyle(Discord.ButtonStyle.Success)
										.setCustomId(`${reporterSteamId64}_REPORT_RESOLVED`)
										.setLabel("Resolved")
										.setDisabled(true)
								),
							],
						});
					} catch (err) {
						log.error(err, "Failed to edit resolved button");
					}
				}

				await this.send(
					{ type: "resolve", isResolved: true, resolvedBy, reporterSteamId64 },
					server
				);

				await interaction.followUp({ content: `Report resolved by ${resolvedBy}` });
			} catch (err) {
				log.error(err, "Resolve button error");
				await interaction.followUp({ content: `Could not resolve report: ${err}` });
			}
		});
	}

	static async handle(payload: ReportChatRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { steamId64, content } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const threadData = this.reportThreads[steamId64];
		if (!threadData || threadData.resolved) return;

		const guild = discord.guilds.cache.get(server.bridge.config.guildId);
		if (!guild) return;

		try {
			const thread = (await guild.channels.fetch(
				threadData.channelId
			)) as Discord.ThreadChannel;
			if (!thread) return;

			await thread.send({ content });
		} catch (err) {
			log.error(err, "Failed to send report chat message");
		}
	}

	static async storeThread(
		reporterSteamId64: string,
		channelId: string,
		reportedSteamId64: string
	): Promise<void> {
		this.reportThreads[reporterSteamId64] = { channelId, resolved: false, reportedSteamId64 };
	}
}
