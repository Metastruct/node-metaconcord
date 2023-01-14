import * as requestSchema from "./structures/StatusRequest.json";
import { CountdownType } from "./structures/StatusRequest";
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

const GamemodeColors = {
	qbox: 0x4bf5ca,
	mta: 0xf48702,
	jazztronauts: 0x320032,
};
export default class StatusPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static retryCount = 0;

	static async handle(payload: StatusRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { countdown, defcon, players, map, workshopMap, gamemode, serverUptime, mapUptime } =
			payload.data;
		const { bridge, discord } = server;
		const webApp = bridge.container.getService("WebApp");
		if (!webApp) return;
		const {
			config: { host, port },
		} = webApp;
		const Steam = bridge.container.getService("Steam");

		const updateStatus = async () => {
			const current_countdown = countdown;
			const current_defcon = defcon ?? server.defcon ?? 5;
			const current_players = players ?? server.status.players ?? [];
			const current_map = map ?? server.map ?? "unknown map";
			const current_gamemode = gamemode ??
				server.gamemode ?? { folderName: "???", name: "unknown gamemode" };
			const current_serverUptime = serverUptime ?? server.serverUptime;
			const current_mapUptime = mapUptime ?? server.mapUptime;

			if (current_countdown && current_countdown.typ === CountdownType.AOWL_COUNTDOWN_CUSTOM)
				return;

			const count = current_players.length;

			if (!discord) return;

			const guild = discord.guilds.cache.get(discord.config.guildId);
			if (!guild) return;

			// Nick
			if (discord.user) {
				const me = guild.members.cache.get(discord.user.id);
				if (me?.nickname !== server.config.name) me?.setNickname(server.config.name);

				// Presence
				const presence: Discord.PresenceData =
					count > 0
						? {
								activities: [
									{
										name: `${count} player${count != 1 ? "s" : ""}`,
										type: 3,
									},
								],
								status:
									current_defcon === 1 || current_countdown ? "dnd" : "online",
						  }
						: {
								afk: true,
								status: current_defcon === 1 || current_countdown ? "dnd" : "idle",
								activities: [],
						  };
				if (current_countdown && presence.activities) {
					presence.activities.push({
						name: `${current_countdown.text} in ${current_countdown.time} seconds`,
						type: 3,
					});
				}
				if (current_defcon !== 5 && presence.activities) {
					presence.activities.push({ name: "DEFCON " + current_defcon, type: 5 });
				}
				discord.user.setPresence(presence);
			}
			// Permanent status message
			let desc = `:busts_in_silhouette: **${count > 0 ? count : "no"} player${
				count > 1 || count == 0 ? "s" : ""
			}**`;
			// Time, kinda sucks we need to calculate but that's just how it is.
			const servertime = dayjs().subtract(current_serverUptime, "s").unix();
			const maptime = dayjs().subtract(current_mapUptime, "s").unix();

			desc += `\n:repeat: <t:${maptime}:R>`;
			desc += `\n:file_cabinet: <t:${servertime}:R>`;
			if (current_countdown)
				desc += `\n<a:ALERTA:843518761160015933> \`${current_countdown.text} in ${current_countdown.time} seconds\` <a:ALERTA:843518761160015933>`;
			if (current_defcon && current_defcon !== 5)
				desc += `\n<a:ALERTA:843518761160015933> \`DEFCON ${current_defcon}\` <a:ALERTA:843518761160015933>`;

			let mapThumbnail: string | null = null;
			if (current_map && /^gm_construct_m/i.test(current_map)) {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/gm_construct_m.jpg`;
			} else if (current_map && current_map.toLowerCase().trim() == "rp_unioncity") {
				mapThumbnail = `http://${host}:${port}/map-thumbnails/rp_unioncity.jpg`;
			}

			const embed = new Discord.EmbedBuilder()
				.setColor(
					current_defcon === 1 || current_countdown
						? 0xff0000
						: current_gamemode
						? GamemodeColors[current_gamemode.name.toLowerCase()]
						: null
				)
				.setFooter({
					text:
						GamemodeAlias[current_gamemode.name.toLowerCase()] ?? current_gamemode.name,
					iconURL: GamemodeIcons[current_gamemode.name.toLowerCase()],
				})
				.setTitle(current_map)
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
						players
							? `http://${host}:${port}/server-status/${
									server.config.id
							  }/${Date.now()}`
							: server.status.image
					)
					.setFooter({
						text: `${
							embed.data.footer ? `${embed.data.footer.text} | ` : ""
						}Middle-click the player list to open an interactive version`,
						iconURL: embed.data.footer?.icon_url,
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

			// Server status metadata
			server.status.mapThumbnail = mapThumbnail;
			server.status.image = embed.data.image?.url ?? null;
			server.status.players = current_players;
			server.defcon = current_defcon;
			server.gamemode = current_gamemode;
			server.map = current_map;
			server.mapUptime = current_mapUptime;
			server.serverUptime = current_serverUptime;
			server.workshopMap = workshopMap;

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
