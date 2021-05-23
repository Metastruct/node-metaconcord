import * as requestSchema from "./structures/BanRequest.json";
import { BanRequest } from "./structures";
import { GameServer } from "..";
import { TextChannel } from "discord.js";
import Discord from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import humanizeDuration from "humanize-duration";

export default class BanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, reason, unbanTime } = payload.data;
		const { bridge, discord: discordClient } = server;

		const guild = await discordClient.guilds
			.resolve(bridge.config.notificationsChannelId)
			?.fetch();
		if (!guild) return;

		const notificationsChannel = await guild.channels
			.resolve(bridge.config.notificationsChannelId)
			?.fetch();
		if (!notificationsChannel) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const bannedAvatar = await steam.getUserAvatar(bannedSteamId64);
		const unixTime = parseInt(unbanTime) * 1000;
		if (!unixTime || isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);
		const banDuration = humanizeDuration(unixTime - Date.now(), {
			round: true,
			units: ["y", "mo", "w", "d", "h", "m"],
		});
		const embed = new Discord.MessageEmbed()
			.setAuthor(
				`${player.nick} banned a player`,
				avatar,
				`https://steamcommunity.com/profiles/${steamId64}`
			)
			.addField("Nick", banned.nick, true)
			.addField("Ban Duration", banDuration, true)
			.addField("Reason", reason.substring(0, 1900))
			.addField(
				"SteamID64",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64})`
			)
			.setThumbnail(bannedAvatar)
			.setColor(0xc42144);
		(notificationsChannel as TextChannel).send({ embed });
	}
}
