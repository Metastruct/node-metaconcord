import * as requestSchema from "./structures/StatusRequest.json";
import { GameServer } from "..";
import { StatusRequest } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import util from "util";

export default class StatusPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: StatusRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { players, map, workshopMap, gamemode } = payload.data;
		const { bridge, discord } = server;
		const {
			config: { host, port },
		} = bridge.container.getService("WebApp");
		const Steam = bridge.container.getService("Steam");

		const updateStatus = async () => {
			const count = players.length;

			// Presence
			discord.user.setPresence({
				activities: [
					{
						name: `${count} player${count != 1 ? "s" : ""}`,
						type: 3,
					},
				],
				status: "online",
			});

			const guild = discord.guilds.cache.get(discord.config.guildId);
			if (!guild) return;

			// Nick
			const me = guild.members.cache.get(discord.user.id);
			if (me.nickname !== server.config.name) me.setNickname(server.config.name);

			// Permanent status message
			let desc = util.format(
				`:busts_in_silhouette: **%d player%s**`,
				count,
				count != 1 ? "s" : ""
			);
			if (gamemode && gamemode.name != "QBox")
				desc += util.format("\n:game_die: **Gamemode**: %s", gamemode.name);
			let mapThumbnail = "";
			if (/^gm_construct_m/i.test(map)) {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/gm_construct_m.jpg`;
			} else if (map.toLowerCase().trim() == "rp_unioncity") {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/rp_unioncity.jpg`;
			}

			const embed = new Discord.MessageEmbed()
				.setColor(0x4bf5ca)
				.setTitle(map)
				.setDescription(desc)
				.setThumbnail(mapThumbnail)
				.setURL(
					`https://metastruct.net/${
						server.config.label ? "join/" + server.config.label : ""
					}`
				);
			if (count > 0) {
				embed
					.setImage(
						`http://${host}:${port}/server-status/${server.config.id}/${Date.now()}`
					)
					.setFooter("Middle-click the player list to open an interactive version");
			}
			if (workshopMap) {
				const res = await Steam.getPublishedFileDetails([workshopMap.id]).catch(
					console.error
				);

				if (res?.publishedfiledetails[0]?.preview_url) {
					embed.setThumbnail(res.publishedfiledetails[0].preview_url);
				}
			}

			// Server status image endpoint
			server.status.mapThumbnail = mapThumbnail;
			server.status.players = players;
			for (const [k, player] of Object.entries(server.status.players)) {
				if (!player.avatar) {
					let avatar: string;
					if (player.accountId) {
						avatar = await Steam.getUserAvatar(
							new SteamID(`[U:1:${player.accountId}]`).getSteamID64()
						);
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

			const channel = guild.channels.cache.get(
				bridge.config.serverInfoChannelId
			) as TextChannel;
			if (!channel) return;

			const messages = await channel.messages.fetch();
			const message = messages
				.filter((msg: Discord.Message) => msg.author.id == discord.user.id)
				.first();
			if (message) {
				message.edit({ embeds: [embed] });
			} else {
				channel.send({ embeds: [embed] });
			}
		};

		if (discord.readyAt) {
			updateStatus().catch(console.error);
		}
	}
}
