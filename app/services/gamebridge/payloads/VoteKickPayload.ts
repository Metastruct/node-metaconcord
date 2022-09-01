import * as requestSchema from "./structures/VoteKickRequest.json";
import { GameServer } from "..";
import { VoteKickRequest } from "./structures";
import Discord, { Message, TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class NotificationPayload extends Payload {
	protected static requestSchema = requestSchema;

	// static async initialize(server: GameServer): Promise<void> {
	// 	const discord = server.discord;
	// 	const notificationsChannel = (await discord.channels.fetch(
	// 		server.discord.config.notificationsChannelId
	// 	)) as TextChannel;
	// 	const steam = server.bridge.container.getService("Steam");
	// 	const filter = (btn: MessageComponentInteraction) => btn.customId.endsWith("_VOTEKICK");
	// 	const collector = notificationsChannel.createMessageComponentCollector({ filter });
	// 	collector.on("collect", async (ctx: ButtonInteraction) => {
	// 		await ctx.deferReply();
	// 		if (!(await DiscordClient.isAllowed(server, ctx.user))) return;
	// 		try {
	// 		} catch (err) {}
	// 		await ctx.update({ components: [] });
	// 	});
	// }

	static async handle(payload: VoteKickRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { offender, reporter, reason, result } = payload.data;
		const { bridge, discord: discordClient } = server;
		const steam = bridge.container.getService("Steam");

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.notificationsChannelId);
		if (!notificationsChannel) return;

		if (result) {
			const success = result.success;
			const reason = result.reason;
			switch (success) {
				case true:
					await this.getLastReport(
						payload.data,
						notificationsChannel as TextChannel
					).then(msg => msg?.react("✅"));
					return;
				case false:
					await this.getLastReport(
						payload.data,
						notificationsChannel as TextChannel
					).then(msg => msg?.react(reason?.includes("Player left") ? "💀" : "❌"));
					return;
				case undefined:
				default:
			}
		}

		let message = reason;
		if (message.trim().length < 1) message = "No reason provided..?";

		const reporterSteamId64 = new SteamID(reporter.steamID).getSteamID64();
		const offenderSteamId64 = new SteamID(offender.steamID).getSteamID64();
		const reporterAvatar = await steam?.getUserAvatar(reporterSteamId64);
		const offenderAvatar = await steam?.getUserAvatar(offenderSteamId64);

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: `${reporter.nick} started a votekick`,
				iconURL: reporterAvatar,
				url: `https://steamcommunity.com/profiles/${reporterSteamId64}`,
			})
			.addField("Nick", offender.nick)
			.addField("Message", message)
			.addField(
				"SteamID",
				`[${offenderSteamId64}](https://steamcommunity.com/profiles/${offenderSteamId64}) (${offender.steamID})`
			)
			.setThumbnail(offenderAvatar)
			.setColor(0xc4af21);

		const data = bridge.container.getService("Data");
		if (data) {
			if (!data.timesVoteKicked[offenderSteamId64])
				data.timesVoteKicked[offenderSteamId64] = 0;
			data.timesVoteKicked[offenderSteamId64]++;
			await data.save();
			if (data.timesVoteKicked[offenderSteamId64] > 0) {
				embed.addField(
					"Total Votekick Amount",
					data.timesVoteKicked[offenderSteamId64].toString()
				);
			}
		}

		await (notificationsChannel as TextChannel).send({
			embeds: [embed],
		});
	}

	static async getLastReport(
		data: {
			offender: { nick: string; steamID: string };
			reporter: { nick: string; steamID: string };
			reason: string;
			success?: boolean;
		},
		channel: TextChannel
	): Promise<Message | undefined> {
		return channel.messages.cache
			.filter(
				msg =>
					msg.author.id === msg.client.user?.id &&
					msg.embeds.some(e =>
						e.fields.some(f => f.value.includes(data.offender.steamID))
					)
			)
			.sort()
			.reverse()
			.first();
	}
}
