import * as requestSchema from "./structures/StatusRequest.json";
import { Embed } from "detritus-client/lib/utils";
import { Message } from "detritus-client/lib/structures";
import { StatusRequest } from "./structures";
import { Steam } from "../../Steam";
import { request as WebSocketRequest } from "websocket";
import Payload from "./Payload";
import SteamID from "steamid";
import app from "@/app";
import util from "util";
import webAppConfig from "@/webapp.json";

export default class StatusPayload extends Payload {
	protected requestSchema = requestSchema;

	async handle(req: WebSocketRequest, payload: StatusRequest): Promise<void> {
		this.validate(this.requestSchema, payload);
		const server = this.server;
		const bridge = this.server.bridge;
		const discordClient = this.server.discord.client;

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
			discordClient.gateway.setPresence(status);

			// Nick
			const me = await discordClient.rest.fetchGuildMember(
				bridge.config.guildId,
				discordClient.userId
			);
			if (me.nick !== server.config.name) me.editNick(server.config.name);

			// Permanent status message
			const desc = util.format(
				":busts_in_silhouette: **%d player%s**",
				count,
				count != 1 ? "s" : ""
			);
			server.status.players = payload.status.players;
			for (const [k, player] of Object.entries(server.status.players)) {
				if (!player.avatar) {
					let avatar;
					if (player.accountId) {
						avatar =
							(
								await app.container
									.getService(Steam)
									.getUserSummaries(
										new SteamID(`[U:1:${player.accountId}]`).getSteamID64()
									)
							)?.avatar?.large ?? undefined;
					}
					if (!avatar) avatar = `https://robohash.org/${Date.now() + k}`;
					player.avatar = avatar;
				}

				player.nick = player.nick.trim();
			}
			server.status.players.sort(function (a, b) {
				let i = 0;
				if (!a.isAdmin && b.isAdmin) i = i + 2;
				if (a.isAdmin && !b.isAdmin) i = i - 2;
				if (a.nick.toLowerCase() > b.nick.toLowerCase()) i++;
				if (a.nick.toLowerCase() < b.nick.toLowerCase()) i--;
				return i;
			});
			server.playerListImage = null;

			const embed = new Embed()
				.setTitle(payload.status.map)
				.setUrl(
					`https://metastruct.net/${
						server.config.label ? "join/" + server.config.label : ""
					}`
				)
				.setDescription(desc)
				.setColor(0x4bf5ca)
				.setThumbnail("https://metastruct.net/img/gm_construct_m.jpg");
			if (count > 0) {
				embed
					.setImage(
						`http://${webAppConfig.host}:${webAppConfig.port}/server-status/${
							server.config.id
						}/${Date.now()}`
					)
					.setFooter("Middle-click the player list to open an interactive version");
			}
			if (payload.status.workshopMap) {
				const res = await app.container
					.getService(Steam)
					.getPublishedFileDetails([payload.status.workshopMap.id])
					.catch(console.error);

				if (res?.publishedfiledetails[0]?.preview_url) {
					embed.setThumbnail(res.publishedfiledetails[0].preview_url);
				}
			}

			const channel = await discordClient.rest.fetchChannel(
				bridge.config.serverInfoChannelId
			);
			const messages = await channel.fetchMessages({});
			const message = messages.filter(
				(msg: Message) => msg.author.id == discordClient.user.id
			)[0];
			if (message) {
				message.edit({ embed });
			} else {
				channel.createMessage({ embed });
			}
		};

		if (discordClient.gateway.connected && discordClient.gateway.state == "READY") {
			updateStatus().catch(console.error);
		} else {
			discordClient.once("gatewayReady", () => {
				updateStatus().catch(console.error);
			});
		}
	}
}
