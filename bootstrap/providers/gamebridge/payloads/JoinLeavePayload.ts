import * as requestSchema from "./structures/JoinLeaveRequest.json";
import { Embed } from "detritus-client/lib/utils";
import { JoinLeaveRequest } from "./structures";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";
import app from "@/app";

export default class JoinLeavePayload extends Payload {
	protected requestSchema = requestSchema;

	public async handle(
		req: WebSocketRequest,
		payload: JoinLeaveRequest
	): Promise<void> {
		this.validate(this.requestSchema, payload);

		const relayChannel = await this.bot.client.rest.fetchChannel(
			this.bot.gameBridge.config.relayChannelId
		);

		const summary = await app.container
			.getService(Steam)
			.getUserSummaries(payload.player.steamId64);
		const avatar =
			summary && summary.avatar ? summary.avatar.large : undefined;

		const embed = new Embed()
			.setAuthor(
				`${payload.player.name} has ${
					payload.spawned ? "spawned" : "left"
				}`,
				avatar,
				`https://steamcommunity.com/profiles/${payload.player.steamId64}`
			)
			.setColor(payload.spawned ? 0x4bb543 : 0xb54343);
		if (payload.reason) embed.setDescription(`Reason: ${payload.reason}`);
		relayChannel.createMessage({ embed });
	}
}
