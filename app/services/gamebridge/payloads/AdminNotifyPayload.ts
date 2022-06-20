import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { GameServer } from "..";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const callAdminRole = guild.roles.cache.get(bridge.config.callAdminRoleId);

		const notificationsChannel = guild.channels.cache.get(bridge.config.notificationsChannelId);
		if (!notificationsChannel) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reported.steamId).getSteamID64();
		const data = bridge.container.getService("Data");
		if (data) {
			if (!data.timesReported[reportedSteamId64]) data.timesReported[reportedSteamId64] = 0;
			data.timesReported[reportedSteamId64]++;
			await data.save();
		}
		const steam = bridge.container.getService("Steam");
		const avatar = await steam?.getUserAvatar(steamId64);
		const reportedAvatar = await steam?.getUserAvatar(reportedSteamId64);
		if (message.trim().length < 1) message = "No message provided..?";

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: `${player.nick} reported a player`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${steamId64}`,
			})
			.addField("Nick", reported.nick)
			.addField("Message", message)
			.addField(
				"SteamID",
				`[${reportedSteamId64}](https://steamcommunity.com/profiles/${reportedSteamId64}) (${reported.steamId})`
			)
			.addField(
				"Report Amount",
				data?.timesReported[reportedSteamId64].toString() || "No Data"
			)
			.setThumbnail(reportedAvatar)
			.setColor(0xc4af21);
		// You can have a maximum of five ActionRows per message, and five buttons within an ActionRow.
		const row = new Discord.MessageActionRow().addComponents([
			{
				label: "KICK Offender",
				type: 2,
				style: "SECONDARY",
				emoji: "🥾",
				customId: `${reportedSteamId64}_REPORT_KICK`,
			},
			{
				label: "KICK Reporter",
				type: 2,
				style: "SECONDARY",
				emoji: "🥾",
				customId: `${steamId64}_REPORT_KICK`,
			},
		]);

		try {
			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				embeds: [embed],
				components: [row],
			});
		} catch {
			embed.fields = embed.fields.filter(f => f.name !== "Message");

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				files: [
					{
						name: `${player.nick} Report.txt`,
						attachment: Buffer.from(message, "utf8"),
					},
				],
				embeds: [embed],
				components: [row],
			});
		}
	}
}
