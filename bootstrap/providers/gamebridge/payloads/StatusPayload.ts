import * as requestSchema from "./structures/StatusRequest.json";
import * as util from "util";
import { Embed } from "detritus-client/lib/utils";
import { StatusRequest } from "./structures";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";
import app from "@/app";

export default class StatusPayload extends Payload {
	protected requestSchema = requestSchema;

	public async handle(req: WebSocketRequest, payload: StatusRequest): Promise<void> {
		this.validate(this.requestSchema, payload);

		const updateStatus = async () => {
			const count = payload.status.players.length;

			// Presence
			const status = {
				activity: {
					name: `${count} player${count != 1 ? "s" : ""}`,
					type: 3,
				},
				status: "online",
			};
			this.bot.client.gateway.setPresence(status);
			const guild = this.bot.client.guilds.get(this.bot.gameBridge.config.guildId);
			const serverInfoChannel = this.bot.client.channels.get(
				this.bot.gameBridge.config.serverInfoChannelId
			);

			// Nick
			/*
			const hostname = payload.status.hostname.match(
				/Meta Construct\s*.?.? - (.*)/i
			)[1];
			if (hostname) guild.me.editNick(hostname.substring(0, 32));
			*/
			if (guild.me.nick !== this.bot.config.name) guild.me.editNick(this.bot.config.name);

			// Permanent status message
			let desc = ":busts_in_silhouette: **%d player%s**";
			if (count > 0) {
				desc += ":\n```\n%s\n```";
			}
			desc = util.format(
				desc,
				count,
				count != 1 ? "s" : "",
				payload.status.players.join(", ")
			);

			const embed = new Embed()
				.setTitle(payload.status.map)
				.setUrl(
					`https://metastruct.net/${
						this.bot.config.label ? "join/" + this.bot.config.label : ""
					}`
				)
				.setDescription(desc)
				.setColor(0x4bf5ca)
				.setThumbnail("https://metastruct.net/img/gm_construct_m.jpg");
			if (payload.status.workshopMap) {
				const res = await app.container
					.getService(Steam)
					.getPublishedFileDetails([payload.status.workshopMap.id])
					.catch(console.error);

				if (res?.publishedfiledetails[0]?.preview_url) {
					embed.setThumbnail(res.publishedfiledetails[0].preview_url);
				}
			}

			const messages = await serverInfoChannel.fetchMessages({});
			const message = messages.filter(msg => msg.author.id == this.bot.client.user.id)[0];
			if (message) {
				message.edit({ embed });
			} else {
				serverInfoChannel.createMessage({ embed });
			}
		};

		if (this.bot.client.gateway.connected && this.bot.client.gateway.state == "READY") {
			updateStatus();
		} else {
			this.bot.client.once("gatewayReady", () => {
				updateStatus();
			});
		}
	}
}
