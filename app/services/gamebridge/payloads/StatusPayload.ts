import * as requestSchema from "./structures/StatusRequest.json";
import { GameServer } from "..";
import { StatusRequest } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import dayjs from "dayjs";

const GamemodeIcons = {
	qbox: "https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull.png?inline=false",
	mta: "https://gitlab.com/metastruct/mta_projects/mta_gm/-/raw/master/gamemodes/mta/icon24.png?inline=false",
	jazztronauts:
		"https://github.com/Foohy/jazztronauts/blob/master/gamemodes/jazztronauts/icon24.png?raw=true",
};

const GamemodeAlias = {
	qbox: "metastruct",
};
export default class StatusPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static retryCount = 0;

	static async handle(payload: StatusRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { players, map, workshopMap, gamemode, serverUptime, mapUptime } = payload.data;
		const { bridge, discord } = server;
		const webApp = bridge.container.getService("WebApp");
		if (!webApp) return;
		const {
			config: { host, port },
		} = webApp;
		const Steam = bridge.container.getService("Steam");

		const updateStatus = async () => {
			const count = players.length;

			if (!discord) return;

			const guild = discord.guilds.cache.get(discord.config.guildId);
			if (!guild) return;

			// Nick
			if (discord.user) {
				const me = guild.members.cache.get(discord.user.id);
				if (me?.nickname !== server.config.name) me?.setNickname(server.config.name);

				// Presence
				discord.user.setPresence(
					count > 0
						? {
								activities: [
									{
										name: `${count} player${count != 1 ? "s" : ""}`,
										type: 3,
									},
								],
								status: "online",
						  }
						: { afk: true, status: "idle" }
				);
			}
			// Permanent status message
			let desc = `:busts_in_silhouette: **${count > 0 ? count : "no"} player${
				count > 1 || count == 0 ? "s" : ""
			}**`;
			// Time, kinda sucks we need to calculate but that's just how it is.
			const servertime = dayjs().subtract(serverUptime, "s").unix();
			const maptime = dayjs().subtract(mapUptime, "s").unix();

			desc += `\n:repeat: <t:${maptime}:R>`;
			desc += `\n:file_cabinet: <t:${servertime}:R>`;
			if (gamemode && gamemode.name != "QBox") desc += `\n:game_die: ${gamemode.name}`;
			let mapThumbnail: string | null = null;
			if (/^gm_construct_m/i.test(map)) {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/gm_construct_m.jpg`;
			} else if (map.toLowerCase().trim() == "rp_unioncity") {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/rp_unioncity.jpg`;
			}

			const embed = new Discord.EmbedBuilder()
				.setColor(0x4bf5ca)
				.setTitle(map)
				.setDescription(desc)
				.setThumbnail(mapThumbnail)
				.setAuthor({
					name: GamemodeAlias[gamemode.name.toLowerCase()],
					iconURL: GamemodeIcons[gamemode.name.toLowerCase()],
				})
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
					.setFooter({
						text: "Middle-click the player list to open an interactive version",
					});
			}
			if (workshopMap) {
				const res = await Steam?.getPublishedFileDetails([workshopMap.id]).catch(
					console.error
				);

				if (res?.publishedfiledetails[0]?.preview_url) {
					embed.setThumbnail(res.publishedfiledetails[0].preview_url);
					if (mapThumbnail === null) {
						mapThumbnail = res.publishedfiledetails[0].preview_url;
					}
				}
			}

			// Server status image endpoint
			server.status.mapThumbnail = mapThumbnail;
			server.status.players = players;
			for (const [, player] of Object.entries(server.status.players)) {
				if (!player.avatar) {
					let avatar: string | undefined;
					if (player.accountId) {
						avatar = await Steam?.getUserAvatar(
							SteamID.fromIndividualAccountID(player.accountId).getSteamID64()
						);
					}
					player.avatar = avatar ?? `https://robohash.org/${player.accountId}`;
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

			const channel = guild.channels.cache.get(
				bridge.config.serverInfoChannelId
			) as TextChannel;
			if (!channel) return;

			const messages = await channel.messages.fetch();
			const message = messages
				.filter((msg: Discord.Message) => msg.author.id == discord.user?.id)
				.first();
			if (message) {
				await message.edit({ embeds: [embed] });
			} else {
				channel.send({ embeds: [embed] });
			}
		};

		if (discord.isReady() && this.retryCount < 5) {
			try {
				updateStatus();
			} catch (e) {
				this.retryCount++;
				console.error(e);
			}
		}
	}
}
