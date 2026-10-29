import * as Discord from "discord.js";
import SteamID from "steamid";

import { f, logger } from "#utils";
import type GmodConnection from "#/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import { type VoteKickRequest } from "./structures/index.js";
import requestSchema from "./structures/VoteKickRequest.json" with { type: "json" };

const log = logger(import.meta);

function reasonToReaction(reason: string) {
	if (typeof reason !== "string")
		return "❌";

	if (reason.includes("Player left"))
		return "🏃‍♂️";
	if (reason.includes("not enough coins"))
		return "💲";
	if (reason.includes("caller has left"))
		return "🤦‍♂️";
	if (reason.includes("Vote was aborted"))
		return "⛔";

	return "❌";
}

export default class VoteKickPayload extends Payload {
	protected static override requestSchema = requestSchema;
	private static votekickCache: {
		[steamId64: string]: number;
	} = {};

	static override async handle(payload: VoteKickRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { offender, reporter, reason, result } = payload.data;
		const { bridge, discord } = server;
		const steam = bridge.container.getService("Steam");

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(discord.config.threads.votekicks);
		if (!notificationsChannel) return;

		const relayChannel = guild.channels.cache.get(discord.config.channels.relay);

		if (result) {
			const success = result.success;
			const reason = result.reason;

			if (success) {
				if (relayChannel) {
					await this.getLastReport(payload.data, relayChannel as Discord.TextChannel)
						.then(msg => msg?.react("✅"))
						.catch(error => log.error(error));
				}
				await this.getLastReport(payload.data, notificationsChannel as Discord.TextChannel)
					.then(msg => msg?.react("✅"))
					.catch(error => log.error(error));
				return;
			}

			if (relayChannel) {
				await this.getLastReport(
					payload.data,
					relayChannel as Discord.TextChannel
				).then(msg =>
					msg?.react(reasonToReaction(reason))
				);
			}
			await this.getLastReport(
				payload.data,
				notificationsChannel as Discord.TextChannel
			).then(msg =>
				msg?.react(reasonToReaction(reason))
			);
			return;
		}

		let message = reason;
		if (message.trim().length === 0) message = "No reason provided..?";

		const reporterSteamId64 = new SteamID(reporter.steamID).getSteamID64();
		const offenderSteamId64 = offender.steamID.startsWith("STEAM")
			? new SteamID(offender.steamID).getSteamID64()
			: offender.steamID;
		const reporterAvatar = await steam.getUserAvatar(reporterSteamId64);
		const offenderAvatar = await steam.getUserAvatar(offenderSteamId64);

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${reporter.nick} started a votekick`,
				iconURL: reporterAvatar,
				url: `https://steamcommunity.com/profiles/${reporterSteamId64}`,
			})
			.addFields(f("Nick", offender.nick))
			.addFields(f("Message", message))
			.addFields(
				f(
					"SteamID",
					`[${offenderSteamId64}](https://steamcommunity.com/profiles/${offenderSteamId64}) (${offender.steamID})`
				)
			)
			.setThumbnail(offenderAvatar ?? null)
			.setColor(0xC4_AF_21);

		if (offenderSteamId64 !== "BOT") {
			const remoteDB = bridge.container.getService("RemoteDB");
			if (!this.votekickCache[offenderSteamId64]) {
				const res = await remoteDB.query(
					`SELECT votekick_amount FROM playerstats WHERE accountid = ${
						new SteamID(offender.steamID).accountid
					}`
				);
				if (res[0]) {
					this.votekickCache[offenderSteamId64] = res[0].votekick_amount;
				} else {
					this.votekickCache[offenderSteamId64] = 0;
				}
			}
			this.votekickCache[offenderSteamId64]++;
			if (this.votekickCache[offenderSteamId64] > 0) {
				embed.addFields(
					f("Total Votekick Amount", this.votekickCache[offenderSteamId64].toString())
				);
			}
		}

		await (notificationsChannel as Discord.TextChannel).send({
			embeds: [embed],
		});
		if (relayChannel) {
			await (relayChannel as Discord.TextChannel).send({
				embeds: [embed],
			});
		}
	}

	static async getLastReport(
		data: {
			offender: { nick: string; steamID: string };
			reporter: { nick: string; steamID: string };
			reason: string;
			success?: boolean;
		},
		channel: Discord.TextChannel
	): Promise<Discord.Message | undefined> {
		return channel.messages.cache
			.filter(
				msg =>
					msg.author.id === msg.client.user?.id &&
					msg.embeds.some(
						e =>
							e.author?.name?.includes("votekick") &&
							e.fields.some(f => f.value.includes(data.offender.steamID))
					)
			)
			.sorted()
			.last();
	}
}
