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

	public async handle(
		req: WebSocketRequest,
		payload: StatusRequest
	): Promise<void> {
		this.validate(this.requestSchema, payload);

		const ip = req.httpRequest.connection.remoteAddress;
		const bot = this.gameBridge.getBot(ip, this.connection);
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
			bot.client.gateway.setPresence(status);
			const guild = bot.client.guilds.get(this.gameBridge.config.guildId);
			const serverInfoChannel = bot.client.channels.get(
				this.gameBridge.config.serverInfoChannelId
			);

			// Nick
			/*
			const hostname = payload.status.hostname.match(
				/Meta Construct\s*.?.? - (.*)/i
			)[1];
			if (hostname) guild.me.editNick(hostname.substring(0, 32));
			*/
			guild.me.editNick(bot.config.name);

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
						bot.config.label ? "join/" + bot.config.label : ""
					}`
				)
				.setDescription(desc)
				.setColor(0x4bf5ca);
			if (payload.status.workshopMap) {
				embed.setThumbnail(
					(
						await app.container
							.getService(Steam)
							.getPublishedFileDetails([
								payload.status.workshopMap.id,
							])
					).publishedfiledetails[0].preview_url
				);
			} else {
				embed.setThumbnail(
					"https://metastruct.net/img/gm_construct_m.jpg"
				);
			}

			const messages = await serverInfoChannel.fetchMessages({});
			const message = messages.filter(
				msg => msg.author.id == bot.client.user.id
			)[0];
			if (message) {
				message.edit({ embed });
			} else {
				serverInfoChannel.createMessage({ embed });
			}
		};

		if (bot.ran) {
			updateStatus();
		} else {
			bot.client.once("gatewayReady", () => {
				updateStatus();
			});
		}
	}
}
