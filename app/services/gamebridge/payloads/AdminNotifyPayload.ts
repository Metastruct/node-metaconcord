import * as Discord from "discord.js";
import { AdminNotifyRequest } from "./structures/index.js";
import { f, logger } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import ReportChatPayload from "./ReportChatPayload.js";
import SteamID from "steamid";
import requestSchema from "./structures/AdminNotifyRequest.json" with { type: "json" };

const log = logger(import.meta);

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static reportCache: {
		[steamId64: string]: number;
	} = {};

	private static activeReportEmbeds: Map<
		string,
		{ guildId: string; channelId: string; messageId: string }
	> = new Map();

	private static embedKey(serverId: number, steamId64: string): string {
		return `${serverId}:${steamId64}`;
	}

	static async updateReporterStatus(server: GameServer): Promise<void> {
		const prefix = server.config.id + ":";
		for (const [key, ref] of this.activeReportEmbeds) {
			if (!key.startsWith(prefix)) continue;

			const steamId64 = key.slice(prefix.length);
			const isOnline = server.status.players.some(p => p.steamId64 === steamId64);

			try {
				const guild = server.discord.guilds.cache.get(ref.guildId);
				if (!guild) continue;
				const channel = (await guild.channels.fetch(ref.channelId)) as Discord.TextChannel;
				if (!channel) continue;
				const message = await channel.messages.fetch(ref.messageId);
				if (!message) continue;

				const oldEmbed = message.embeds[0];
				if (!oldEmbed) continue;

				const statusIdx = oldEmbed.fields.findIndex(f => f.name === "Reporter Status");
				if (statusIdx === -1) continue;

				const newEmbed = Discord.EmbedBuilder.from(oldEmbed);
				newEmbed.spliceFields(statusIdx, 1, {
					name: "Reporter Status",
					value: isOnline ? "🟢 Online" : "🔴 Offline",
					inline: oldEmbed.fields[statusIdx].inline,
				});

				await message.edit({ embeds: [newEmbed] });
			} catch (err) {
				log.error(err, `Failed to update reporter status for ${steamId64}`);
			}
		}
	}

	static async initialize(server: GameServer): Promise<void> {
		const discord = server.discord;
		const reportsChannel = discord.channels.cache.get(
			server.discord.config.channels.reports
		) as Discord.TextChannel;
		if (!reportsChannel) return;
		const steam = server.bridge.container.getService("Steam");

		const kickFilter = (btn: Discord.MessageComponentInteraction) =>
			btn.customId.endsWith("_REPORT_KICK");
		const kickCollector = reportsChannel.createMessageComponentCollector({
			filter: kickFilter,
		});

		kickCollector.on("collect", async (ctx: Discord.ButtonInteraction) => {
			if (!(await server.discord.isAllowed(ctx.user))) {
				await ctx.reply({
					content: "you're not allowed to use this button...",
					flags: Discord.MessageFlags.Ephemeral,
				});
				return;
			}
			await ctx.deferReply();
			try {
				const interactionId64 = new SteamID(
					ctx.customId.replace("_REPORT_KICK", "")
				).getSteamID64();
				const res = await server.sendLua(
					`local ply = player.GetBySteamID64("${interactionId64}") if not ply then return false end ply:Kick("Kicked by Discord (${ctx.user.username}) for a related report.")`,
					"sv",
					ctx.user.username
				);

				if (!res) {
					await ctx.followUp({
						content: `${ctx.user.mention}, could not kick player: server not connected`,
					});
				} else if (res.data.returns[0] !== "false") {
					const summary = await steam.getUserSummaries(interactionId64);
					await ctx.followUp({
						content: `${ctx.user.mention} kicked player \`${
							summary ? summary.personaname : "[nickname not found]"
						}\``,
					});
				} else {
					await ctx.followUp({
						content: `${ctx.user.mention}, could not kick player: not on server`,
					});
				}
			} catch (err) {
				await ctx.followUp({
					content: `${ctx.user.mention}, could not kick player: ${err}`,
				});
			}
		});

		const resolveFilter = (btn: Discord.MessageComponentInteraction) =>
			btn.customId.endsWith("_REPORT_RESOLVE");
		const resolveCollector = reportsChannel.createMessageComponentCollector({
			filter: resolveFilter,
		});

		resolveCollector.on("collect", async (ctx: Discord.ButtonInteraction) => {
			if (!(await server.discord.isAllowed(ctx.user))) {
				await ctx.reply({
					content: "you're not allowed to use this button...",
					flags: Discord.MessageFlags.Ephemeral,
				});
				return;
			}
			const steamId64 = ctx.customId.replace("_REPORT_RESOLVE", "");
			const threadChannelId = ctx.message.thread?.id;
			const data = server.bridge.container.getService("Data");
			if (data?.reportThreads && data.reportThreads[steamId64]) {
				const idx = data.reportThreads[steamId64].findIndex(
					t => t.channelId === threadChannelId
				);
				if (idx !== -1) data.reportThreads[steamId64].splice(idx, 1);
				await data.save();
			}
			this.activeReportEmbeds.delete(this.embedKey(server.config.id, steamId64));
			await ctx.deferUpdate();

			try {
				const thread = ctx.message.thread;
				if (thread) {
					await thread.setLocked(true);
					await thread.setArchived(true);
				}
			} catch (err) {
				log.error(err, "Failed to lock report thread");
			}

			try {
				await ReportChatPayload.send(
					{
						type: "resolve",
						isResolved: true,
						resolvedBy: ctx.user.username,
						reporterSteamId64: steamId64,
					},
					server
				);
			} catch (err) {
				log.error(err, "Failed to send resolve notification");
			}
			try {
				const newResolveBtn = new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Success)
					.setCustomId(`${steamId64}_REPORT_RESOLVED`)
					.setEmoji("✅")
					.setLabel("Resolved")
					.setDisabled(true);
				await ctx.message.edit({
					components: [
						new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
							newResolveBtn
						),
					],
				});
			} catch (err) {
				ctx.followUp({ content: `Failed to resolve report: ${err}` }).catch(() => {});
			}
		});
	}

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.ready) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const reportsChannel = (await guild.channels.fetch(
			server.discord.config.channels.reports
		)) as Discord.TextChannel | null;
		if (!reportsChannel || !reportsChannel.isTextBased()) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = reported.steamId.startsWith("STEAM")
			? new SteamID(reported.steamId).getSteamID64()
			: reported.steamId;
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const reportedAvatar = await steam.getUserAvatar(reportedSteamId64);
		const selfReport = player.steamId === reported.steamId;

		if (message.trim().length < 1) message = "No message provided..?";

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} reported a player`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${steamId64}`,
			})
			.addFields(f("Nick", reported.nick))
			.addFields(f("Message", message))
			.addFields(
				f(
					"SteamID",
					`[${reportedSteamId64}](https://steamcommunity.com/profiles/${reportedSteamId64}) (${reported.steamId})`
				)
			)
			.setThumbnail(reportedAvatar ?? null)
			.setColor(0xc4af21);

		if (reportedSteamId64 !== "BOT") {
			const sql = bridge.container.getService("SQL");
			if (!this.reportCache[reportedSteamId64]) {
				const res = await sql.queryPool(
					`SELECT report_amount FROM playerstats WHERE accountid = ${
						new SteamID(reported.steamId).accountid
					}`
				);
				if (res[0]) {
					this.reportCache[reportedSteamId64] = res[0].report_amount;
				} else {
					this.reportCache[reportedSteamId64] = 0;
				}
			}
			this.reportCache[reportedSteamId64]++;

			if (this.reportCache[reportedSteamId64] > 0) {
				embed.addFields(
					f("Total Report Amount", this.reportCache[reportedSteamId64].toString())
				);
			}
		}

		embed.addFields(f("Reporter Status", "🟢 Online"));

		const kickRow = new Discord.ActionRowBuilder<Discord.ButtonBuilder>();
		if (selfReport) {
			kickRow.addComponents(
				new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Secondary)
					.setCustomId(`${reportedSteamId64}_REPORT_KICK`)
					.setEmoji("🥾")
					.setLabel("KICK Self Reporter")
			);
		} else {
			kickRow.addComponents(
				new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Secondary)
					.setCustomId(`${reportedSteamId64}_REPORT_KICK`)
					.setEmoji("🥾")
					.setLabel("KICK Offender"),
				new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Secondary)
					.setCustomId(`${steamId64}_REPORT_KICK`)
					.setEmoji("🥾")
					.setLabel("KICK Reporter")
			);
		}

		const resolveRow = new Discord.ActionRowBuilder<Discord.ButtonBuilder>();
		resolveRow.addComponents(
			new Discord.ButtonBuilder()
				.setStyle(Discord.ButtonStyle.Primary)
				.setCustomId(`${steamId64}_REPORT_RESOLVE`)
				.setEmoji("✅")
				.setLabel("Resolve Report")
		);

		const callAdminRole = server.discord.config.roles.callAdmin;
		const sendReportMessage = async () => {
			try {
				return await reportsChannel.send({
					content: `<@&${callAdminRole}> new ingame report from ${player.nick}`,
					embeds: [embed],
					components: [kickRow, resolveRow],
				});
			} catch {
				embed.spliceFields(1, 1);

				return await reportsChannel
					.send({
						content: `<@&${callAdminRole}> new ingame report from ${player.nick}`,
						files: [
							{
								name: `${player.nick} Report.txt`,
								attachment: Buffer.from(message, "utf8"),
							},
						],
						embeds: [embed],
						components: [kickRow, resolveRow],
					})
					.catch(() => undefined);
			}
		};

		const sentMsg = await sendReportMessage();
		if (sentMsg) {
			this.activeReportEmbeds.set(this.embedKey(server.config.id, steamId64), {
				guildId: guild.id,
				channelId: reportsChannel.id,
				messageId: sentMsg.id,
			});

			const thread = await sentMsg.startThread({
				name: `Report - ${player.nick} → ${reported.nick}`,
				autoArchiveDuration: 60,
			});
			await ReportChatPayload.storeThread(steamId64, thread.id, reportedSteamId64, server);
		}
	}
}
