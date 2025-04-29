import * as Discord from "discord.js";
import { VoteKickRequest } from "./structures/index.js";
import { f } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import SteamID from "steamid";
import requestSchema from "./structures/VoteKickRequest.json" with { type: "json" };

export default class NotificationPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static votekickCache: {
		[steamId64: string]: number;
	} = {};

	static async handle(payload: VoteKickRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { offender, reporter, reason, result } = payload.data;
		const { bridge, discord: discordClient } = server;
		const steam = await bridge.container.getService("Steam");

		if (!discordClient.ready) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.votekicksChannelId);
		if (!notificationsChannel) return;

		const relayChannel = guild.channels.cache.get(bridge.config.relayChannelId);

		if (result) {
			const success = result.success;
			const reason = result.reason;
			if (success) {
				if (relayChannel) {
					await this.getLastReport(payload.data, relayChannel as Discord.TextChannel)
						.then(msg => msg?.react("✅"))
						.catch(err => console.error(err));
				}
				await this.getLastReport(payload.data, notificationsChannel as Discord.TextChannel)
					.then(msg => msg?.react("✅"))
					.catch(err => console.error(err));
				return;
			} else {
				if (relayChannel) {
					await this.getLastReport(
						payload.data,
						relayChannel as Discord.TextChannel
					).then(msg =>
						msg?.react(
							reason?.includes("Player left")
								? "🏃‍♂️"
								: reason?.includes("not enough coins")
								? "💲"
								: reason?.includes("caller has left")
								? "🤦‍♂️"
								: reason?.includes("Vote was aborted")
								? "⛔"
								: "❌"
						)
					);
				}
				await this.getLastReport(
					payload.data,
					notificationsChannel as Discord.TextChannel
				).then(msg =>
					msg?.react(
						reason?.includes("Player left")
							? "🏃‍♂️"
							: reason?.includes("not enough coins")
							? "💲"
							: reason?.includes("caller has left")
							? "🤦‍♂️"
							: reason?.includes("Vote was aborted")
							? "⛔"
							: "❌"
					)
				);
				return;
			}
		}

		let message = reason;
		if (message.trim().length < 1) message = "No reason provided..?";

		const reporterSteamId64 = new SteamID(reporter.steamID).getSteamID64();
		const offenderSteamId64 = new SteamID(offender.steamID).getSteamID64();
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
			.setThumbnail(offenderAvatar)
			.setColor(0xc4af21);

		const sql = await bridge.container.getService("SQL");
		if (!this.votekickCache[offenderSteamId64]) {
			const res = await sql.queryPool(
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
			.sort()
			.reverse()
			.first();
	}
}
