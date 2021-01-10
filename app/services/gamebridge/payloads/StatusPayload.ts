import * as requestSchema from "./structures/StatusRequest.json";
import { Embed } from "detritus-client/lib/utils";
import { GameServer } from "..";
import { Message } from "detritus-client/lib/structures";
import { StatusRequest } from "./structures";
import Payload from "./Payload";
import SteamID from "steamid";
import util from "util";
import webAppConfig from "@/webapp.json";

export default class StatusPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: StatusRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { players, map, workshopMap } = payload.data;
		const {
			bridge,
			discord: { client: discordClient },
		} = server;

		const updateStatus = async () => {
			const count = players.length;

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
			server.status.players = players;
			for (const [k, player] of Object.entries(server.status.players)) {
				if (!player.avatar) {
					let avatar: string;
					if (player.accountId) {
						avatar = await bridge.container
							.getService("Steam")
							.getUserAvatar(new SteamID(`[U:1:${player.accountId}]`).getSteamID64());
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
				.setTitle(map)
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
			if (workshopMap) {
				const res = await bridge.container
					.getService("Steam")
					.getPublishedFileDetails([workshopMap.id])
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
