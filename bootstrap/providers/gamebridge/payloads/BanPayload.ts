import * as requestSchema from "./structures/BanRequest.json";
import { BanRequest } from "./structures";
import { Embed } from "detritus-client/lib/utils";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";

export default class BanPayload extends Payload {
	protected requestSchema = requestSchema;

	public async handle(_: WebSocketRequest, payload: BanRequest): Promise<void> {
		this.validate(this.requestSchema, payload);

		const relayChannel = await this.bot.client.rest.fetchChannel(
			this.bot.gameBridge.config.relayChannelId
		);

		const unixTime = parseInt(payload.ban.unbanTime);
		const unbanDateTime =
			unixTime == NaN
				? "???"
				: new Date(unixTime * 1000).toISOString().slice(0, 19).replace("T", " ");
		const embed = new Embed()
			.setTitle("Ban")
			.addField("Banned", payload.ban.banned, true)
			.addField("Banner", payload.ban.banner, true)
			.addField("Reason", payload.ban.reason, false)
			.addField("Unban Date", unbanDateTime)
			.setColor(0xc42144);

		relayChannel.createMessage({ embed });
	}
}
