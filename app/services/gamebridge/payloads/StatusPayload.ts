import * as requestSchema from "./structures/StatusRequest.json";
import { CountdownType } from "./structures/StatusRequest";
import { GameServer } from "..";
import { StatusRequest } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import dayjs from "dayjs";

const GamemodeAlias = {
	qbox: "metastruct",
	"ttt2 (advanced update)": "ttt2",
} as const satisfies Record<string, string>;

const GamemodeExtras = {
	jazztronauts: {
		activities: ["stealing props", "collecting shards"],
		icon: "https://github.com/Foohy/jazztronauts/blob/master/gamemodes/jazztronauts/icon24.png?raw=true",
		color: 0x320032,
		seagull: undefined,
	},
	metastruct: {
		activities: ["idling", "micspamming", "spamming chatsounds"],
		icon: "https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull.png?inline=false",
		color: 0x4bf5ca,
		seagull:
			"https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull.png?inline=false",
	},
	mta: {
		activities: ["shooting combines", "drilling vaults", "upgrading skills"],
		icon: "https://github.com/Metastruct/MTA-Gamemode/blob/master/gamemodes/mta/icon24.png?raw=true",
		color: 0xf48702,
		seagull: undefined,
	},
	ttt2: {
		activities: [
			"die",
			"getting bricked",
			"discombobulate",
			"dying to fall damage",
			"argue",
			"kill jester",
			"swapping",
		],
		icon: "https://github.com/Metastruct/TTT2/blob/master/gamemodes/terrortown/logo.png?raw=true",
		color: 0xdcb400,
		seagull:
			"https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull_ttt.png?inline=false",
	},
} as const satisfies Record<
	string,
	{ activities: readonly string[]; icon: string; color: number; seagull?: string }
>;

const getRandomActivity = (gamemode: string) => {
	const activities = GamemodeExtras[gamemode as keyof typeof GamemodeExtras]?.activities;
	if (!activities) return;
	return activities[(Math.random() * activities.length) | 0];
};

export default class StatusPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static retryCount = 0;

	static async handle(payload: StatusRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const {
			countdown,
			defcon,
			players,
			mapName,
			workshopMap,
			gamemode,
			serverUptime,
			mapUptime,
			gamemodes,
		} = payload.data;
		const { bridge, discord } = server;
		const {
			config: { host, port, url },
		} = bridge.webApp;
		const Steam = await bridge.container.getService("Steam");

		const updateStatus = async () => {
			const current_countdown = countdown;
			const current_defcon = defcon ?? server.defcon ?? 5;
			const current_players = players ?? server.status.players ?? [];
			const current_map = mapName ?? server.mapName ?? "unknown map";
			const current_gamemode = gamemode ??
				server.gamemode ?? { folderName: "???", name: "unknown gamemode" };
			const current_gamemodes = gamemodes ?? server.gamemodes ?? [];
			const current_serverUptime = serverUptime ?? server.serverUptime ?? 0;
			const current_mapUptime = mapUptime ?? server.mapUptime ?? 0;
			const current_workshopMap = workshopMap ?? server.workshopMap;

			const mapChanged = server.mapName !== current_map;
			const gamemodeName =
				(GamemodeAlias[current_gamemode.name.toLowerCase()] as string) ??
				current_gamemode.name.toLowerCase();
			const gamemodeExtras = GamemodeExtras[gamemodeName as keyof typeof GamemodeExtras];
			const gamemodeIcon = gamemodeExtras?.seagull ?? gamemodeExtras?.icon;

			if (current_countdown && current_countdown.typ === CountdownType.AOWL_COUNTDOWN_CUSTOM)
				return;

			const count = current_players.length;

			if (!discord) return;

			const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
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
										name: `${count} player${count !== 1 ? "s" : ""} ${
											getRandomActivity(gamemodeName) ?? ""
										}`,
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

				if (current_countdown) {
					presence.activities = [
						{
							name: `${current_countdown.text} in ${current_countdown.time} second${
								current_countdown.time > 1 ? "s" : ""
							}`,
							type: 3,
						},
					];
				}

				if (current_defcon !== 5) {
					presence.activities = [{ name: "DEFCON " + current_defcon, type: 5 }];
				}
				discord.user.setPresence(presence);
			}
			// Permanent status message
			// Map name w/ workshop link
			let desc = `>>> ### ${
				current_workshopMap
					? `[${current_workshopMap.name}](https://steamcommunity.com/sharedfiles/filedetails/?id=${current_workshopMap.id})`
					: current_map
			}`;

			// Player count
			desc += `\n:busts_in_silhouette: Player${
				count > 1 || count == 0 ? "s" : ""
			}: **${count}**`;

			// Map and Server Uptime
			const servertime = dayjs().subtract(current_serverUptime, "s").unix();
			const maptime = dayjs().subtract(current_mapUptime, "s").unix();

			desc += `\n:repeat: Map	uptime: <t:${maptime}:R>`;
			desc += `\n:file_cabinet: Server uptime: <t:${servertime}:R>`;
			if (current_countdown)
				desc += `\n<a:ALERTA:843518761160015933> \`${current_countdown.text} in ${current_countdown.time} seconds\` <a:ALERTA:843518761160015933>`;
			if (current_defcon && current_defcon !== 5)
				desc += `\n<a:ALERTA:843518761160015933> \`DEFCON ${current_defcon}${
					current_defcon === 1 ? " (Restricted Access)" : ""
				}\` <a:ALERTA:843518761160015933>`;

			let mapThumbnail: string | null = mapChanged ? null : server.status.mapThumbnail;
			if (mapThumbnail === null) {
				if (current_map && /^gm_construct_m/i.test(current_map)) {
					mapThumbnail = `${url}/map-thumbnails/gm_construct_m.png`;
				} else if (current_map && current_map.toLowerCase().trim() == "rp_unioncity") {
					mapThumbnail = `${url}/map-thumbnails/rp_unioncity.png`;
				}
			}

			const embed = new Discord.EmbedBuilder()
				.setColor(
					current_defcon === 1 || current_countdown
						? 0xff0000
						: current_gamemode
						? gamemodeExtras?.color ?? null
						: null
				)
				.setFooter({
					text: gamemodeName,
					iconURL: gamemodeExtras?.icon,
				})
				.setAuthor({
					name: server.config.name,
					iconURL: gamemodeIcon,
					url: `https://metastruct.net/${
						server.config.label ? "join/" + server.config.label : ""
					}`,
				})
				.setDescription(desc)
				.setThumbnail(mapThumbnail);

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

			if (mapThumbnail === null && current_workshopMap) {
				const res = await Steam.getPublishedFileDetails([current_workshopMap.id]).catch(
					console.error
				);
				const thumbnailURI = res?.publishedfiledetails?.[0]?.preview_url;

				if (thumbnailURI) {
					embed.setThumbnail(thumbnailURI);
					mapThumbnail = thumbnailURI;
				}
			}

			if (mapThumbnail && server.discordBanner !== mapThumbnail) {
				server.changeBanner(mapThumbnail);
			}

			if (
				gamemodeIcon &&
				(!server.discordIcon || gamemodeIcon !== server.discordIcon || mapChanged)
			) {
				server.changeIcon(gamemodeIcon);
			}

			// Server status metadata
			server.defcon = current_defcon;
			server.gamemode = current_gamemode;
			server.gamemodes = current_gamemodes;
			server.mapName = current_map;
			server.mapUptime = current_mapUptime;
			server.serverUptime = current_serverUptime;
			server.status.image = embed.data.image?.url ?? null;
			server.status.mapThumbnail = mapThumbnail;
			server.status.players = current_players;
			server.workshopMap = current_workshopMap;

			for (const [, player] of Object.entries(server.status.players)) {
				if (!player.avatar) {
					let avatar: string | undefined;
					if (player.accountId) {
						avatar = await Steam.getUserAvatar(
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
				await message.edit({ embeds: [embed] }).catch();
			} else {
				channel.send({ embeds: [embed] }).catch();
			}
		};

		if (discord.ready && this.retryCount < 5) {
			try {
				updateStatus();
			} catch (e) {
				this.retryCount++;
				console.error(e);
			}
		}
	}
}
