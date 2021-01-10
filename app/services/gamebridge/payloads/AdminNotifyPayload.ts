import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { Embed, Markup } from "detritus-client/lib/utils";
import { GameServer } from "..";
import { Role } from "detritus-client/lib/structures";
import Payload from "./Payload";
import SteamID from "steamid";

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const {
			bridge,
			discord: { client: discordClient },
		} = server;

		const callAdminRole = (
			await discordClient.rest.fetchGuildRoles(bridge.config.guildId)
		).find((role: Role) => role.id == bridge.config.callAdminRoleId);
		const notificationsChannel = await discordClient.rest.fetchChannel(
			bridge.config.notificationsChannelId
		);

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reported.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const reportedAvatar = await steam.getUserAvatar(reportedSteamId64);
		if (message.trim().length < 1) message = "No message provided..?";
		const embed = new Embed()
			.setAuthor(
				`${player.nick} reported a player`,
				avatar,
				`https://steamcommunity.com/profiles/${steamId64}`
			)
			.addField("Nick", Markup.escape.all(reported.nick))
			.addField("Message", Markup.escape.all(message.substring(0, 1900)))
			.addField(
				"SteamID64",
				`[${reportedSteamId64}](https://steamcommunity.com/profiles/${steamId64})`
			)
			.setThumbnail(reportedAvatar)
			.setColor(0xc4af21);
		notificationsChannel.createMessage({
			content: callAdminRole && callAdminRole.mention,
			embed,
		});
	}
}
