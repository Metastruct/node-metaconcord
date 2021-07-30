import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { GameServer } from "..";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import fs from "fs";
import path from "path";

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const { bridge, discord: discordClient } = server;

		const guild = await discordClient.guilds.resolve(bridge.config.guildId)?.fetch();
		if (!guild) return;

		const callAdminRole = guild.roles.resolve(bridge.config.callAdminRoleId);

		const notificationsChannel = await guild.channels
			.resolve(bridge.config.notificationsChannelId)
			?.fetch();
		if (!notificationsChannel) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reported.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const reportedAvatar = await steam.getUserAvatar(reportedSteamId64);
		if (message.trim().length < 1) message = "No message provided..?";

		const embed = new Discord.MessageEmbed()
			.setAuthor(
				`${player.nick} reported a player`,
				avatar,
				`https://steamcommunity.com/profiles/${steamId64}`
			)
			.addField("Nick", reported.nick)
			.addField(
				"SteamID",
				`[${reportedSteamId64}](https://steamcommunity.com/profiles/${reportedSteamId64}) (${reported.steamId})`
			)
			.setThumbnail(reportedAvatar)
			.setColor(0xc4af21);

		if (message.length > 200) {
			const reportPath = path.resolve(
				`${Date.now()}_${player.nick}_report.txt`.toLocaleLowerCase()
			);
			await new Promise<void>((resolve, reject) =>
				fs.writeFile(reportPath, message, err => (err ? reject(err.message) : resolve()))
			);

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				files: [reportPath],
				embed: embed,
			});

			await new Promise<void>((resolve, reject) =>
				fs.unlink(reportPath, err => (err ? reject(err.message) : resolve()))
			);
		} else {
			embed.addField("Message", message);

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				embed: embed,
			});
		}
	}
}
