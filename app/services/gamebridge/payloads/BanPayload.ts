import * as requestSchema from "./structures/BanRequest.json";
import { BanRequest } from "./structures";
import { Embed, Markup } from "detritus-client/lib/utils";
import { GameServer } from "..";
import Payload from "./Payload";
import SteamID from "steamid";
import humanizeDuration from "humanize-duration";
import moment from "moment";

export default class BanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, reason, unbanTime } = payload.data;
		const {
			bridge,
			discord: { client: discordClient },
		} = server;

		const notificationsChannel = await discordClient.rest.fetchChannel(
			bridge.config.notificationsChannelId
		);

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const bannedAvatar = await steam.getUserAvatar(bannedSteamId64);
		const unixTime = parseInt(unbanTime) * 1000;
		if (!unixTime || isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);
		const banDuration = humanizeDuration(
			moment.duration(unixTime - Date.now()).asMilliseconds(),
			{ round: true, units: ["y", "mo", "w", "d", "h", "m"] }
		);
		const embed = new Embed()
			.setAuthor(
				`${player.nick} banned a player`,
				avatar,
				`https://steamcommunity.com/profiles/${steamId64}`
			)
			.addField("Nick", Markup.escape.all(banned.nick), true)
			.addField("Ban Duration", banDuration, true)
			.addField("Reason", Markup.escape.all(reason.substring(0, 1900)))
			.addField(
				"SteamID64",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${steamId64})`
			)
			.setThumbnail(bannedAvatar)
			.setColor(0xc42144);
		notificationsChannel.createMessage({ embed });
	}
}
