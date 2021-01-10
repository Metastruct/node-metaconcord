import * as requestSchema from "./structures/JoinLeaveRequest.json";
import { Embed } from "detritus-client/lib/utils";
import { GameServer } from "..";
import { JoinLeaveRequest } from "./structures";
import Payload from "./Payload";

export default class JoinLeavePayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: JoinLeaveRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reason, spawned } = payload.data;
		const {
			bridge,
			discord: { client: discordClient },
		} = server;

		const relayChannel = await discordClient.rest.fetchChannel(bridge.config.relayChannelId);

		const avatar = await bridge.container.getService("Steam").getUserAvatar(player.steamId64);
		const embed = new Embed()
			.setAuthor(
				`${player.nick} has ${spawned ? "spawned" : "left"}`,
				avatar,
				`https://steamcommunity.com/profiles/${player.steamId64}`
			)
			.setColor(spawned ? 0x4bb543 : 0xb54343);
		if (reason) embed.setDescription(`Reason: ${reason}`);
		relayChannel.createMessage({ embed });
	}
}
