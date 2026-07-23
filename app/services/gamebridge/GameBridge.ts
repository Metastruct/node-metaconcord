import * as Discord from "discord.js";
import * as signalR from "@microsoft/signalr";
import { Container, Service } from "@/app/Container.js";
import { ResoniteSession } from "../Resonite.js";
import { WebApp } from "@/app/services/webapp/index.js";
import GameConnection from "./GameConnection.js";
import { attachGmod } from "./games/gmod/index.js";
import config from "@/config/gamebridge.json" with { type: "json" };
import servers from "@/config/gamebridge.servers.json" with { type: "json" };
import resoniteConfig from "@/config/resonite.json" with { type: "json" };
import { renderPlayerListImage } from "./renderPlayerList.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export default class GameBridge extends Service {
	name = "GameBridge";
	config = {
		servers,
		...config,
	};
	webApp: WebApp;
	servers: GameConnection[] = [];
	discordChatWH = new Discord.WebhookClient({
		url: config.chatWebhookUrl,
	});
	discordErrorWH = new Discord.WebhookClient({
		url: config.errorWebhookUrl,
	});
	discordPacErrorWH = new Discord.WebhookClient({
		url: config.pacErrorWebhookUrl,
	});
	ready: boolean = false;

	constructor(container: Container) {
		super(container);
	}

	async init() {
		this.webApp = this.container.getService("WebApp");

		attachGmod(this);

		this.ready = true;
		this.handleResoniteConnection();
	}

	async handleResoniteConnection(): Promise<void> {
		const resonite = this.container.getService("Resonite");
		const id = 9;

		const con = new signalR.HubConnectionBuilder()
			.withUrl("https://api.resonite.com/hub", {
				headers: { Authorization: `res ${resonite.UserID}:${resonite.ResoniteToken}` },
			})
			.configureLogging(signalR.LogLevel.Error)
			.withAutomaticReconnect()
			.build();

		con.start()
			.then(() => {
				const server = (this.servers[id] = new GameConnection({
					bridge: this,
					serverConfig: {
						name: "#resonite 🇪🇺",
						id,
						discordToken: resoniteConfig.discordToken,
					},
				}));
				server.discord.on("clientReady", () => {
					if (server.status.mapThumbnail) server.changeBanner(server.status.mapThumbnail);
				});
			})
			.catch(() => {});

		let lastCount = 1;
		con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
			try {
				const server = this.servers[id];
				if (!server) throw new Error("Server not found");
				if (session.hostUserId === resonite.UserID) {
					const discord = server.discord;
					const count = session.joinedUsers;

					// update until last person leaves
					if (discord.ready && (lastCount !== count || count !== 0)) {
						lastCount = count;
						const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
						if (!guild) throw new Error("Guild not found");

						const channel = guild.channels.cache.get(
							config.serverInfoChannelId
						) as Discord.TextChannel;
						if (!channel) throw new Error("Channel not found");

						const presence: Discord.PresenceData =
							count > 0
								? {
										status: "online",
										activities: [
											{
												name: `${count === 1 ? "a" : count} player${count !== 1 ? "s" : ""}`,
												type: 3,
											},
										],
									}
								: {
										status: "idle",
										afk: true,
										activities: [],
									};

						discord.user?.setPresence(presence);

						const mapThumbnail =
							session.thumbnailUrl ?? "https://metastruct.net/img/logo.png";
						server.changeBanner(mapThumbnail);
						server.status.mapThumbnail = mapThumbnail;

						server.status.players = session.sessionUsers
							.filter(u => u.userID !== resonite.UserID)
							.map(sessionUser => {
								return {
									nick: sessionUser.username,
									isAfk: !sessionUser.isPresent,
									steamId64: "0",
									isAdmin: false,
									isBanned: false,
									ip: sessionUser.userID,
									avatar: undefined,
								};
							});

						server.status.players.forEach(
							async u => (u.avatar = await resonite.GetResoniteUserAvatarURL(u.ip))
						);

						const container = new Discord.ContainerBuilder();

						container.setAccentColor(4796260);

						const desc =
							`### ${session.tags[0] ?? session.name}\n` +
							`:busts_in_silhouette: Player${
								count > 1 || count == 0 ? "s" : ""
							}: **${session.activeUsers}/${count}**\n` +
							`:repeat: Last Update: <t:${
								(new Date(session.lastUpdate).getTime() / 1000) | 0
							}:R>\n` +
							`:file_cabinet: Server up since: <t:${(new Date(session.sessionBeginTime).getTime() / 1000) | 0}:R>`;

						container.addSectionComponents(section =>
							section
								.addTextDisplayComponents(text => text.setContent(desc))
								.setThumbnailAccessory(accessory =>
									accessory
										.setURL(mapThumbnail)
										.setDescription(session.tags.join())
								)
						);

						if (count > 0) {
							container.addSeparatorComponents(sep => sep);
							container.addMediaGalleryComponents(gallery =>
								gallery.addItems(item => item.setURL("attachment://players.png"))
							);
						}

						container.addSeparatorComponents(sep => sep);

						container.addActionRowComponents(row =>
							row.setComponents(
								new Discord.ButtonBuilder()
									.setStyle(Discord.ButtonStyle.Link)
									.setLabel("Connect")
									.setURL(`https://go.resonite.com/session/${session.sessionId}`)
							)
						);

						container.addSeparatorComponents(sep => sep);

						container.addTextDisplayComponents(text =>
							text.setContent("-# metastruct @ Resonite")
						);

						server.playerListImage = await renderPlayerListImage(
							server.status.players,
							mapThumbnail
						);

						const messages = await channel.messages.fetch();
						const message = messages
							.filter((msg: Discord.Message) => msg.author.id == discord.user?.id)
							.first();
						if (message) {
							await message.edit({
								components: [container],
								files: [
									new Discord.AttachmentBuilder(server.playerListImage).setName(
										"players.png"
									),
								],
								flags: Discord.MessageFlags.IsComponentsV2,
							});
						} else {
							channel
								.send({
									components: [container],
									files: [
										new Discord.AttachmentBuilder(
											server.playerListImage
										).setName("players.png"),
									],
									flags: Discord.MessageFlags.IsComponentsV2,
								})
								.catch(() => {});
						}
					}
				}
			} catch (err) {
				log.error(err, "ReceiveSessionUpdate");
			}
		});

		con.onclose(() => {
			this.servers[id]?.discord.user?.setPresence({ status: "dnd" });
		});
		con.onreconnected(() => {
			this.servers[id]?.discord.user?.setPresence({ status: "online" });
		});
	}
}
