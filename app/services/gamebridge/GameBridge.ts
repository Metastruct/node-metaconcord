import * as Discord from "discord.js";
import * as payloads from "./payloads/index.js";
import * as signalR from "@microsoft/signalr";
import { Container, Service } from "@/app/Container.js";
import { GameServerConfig } from "./GameServer.js";
import { ResoniteSession } from "../Resonite.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { request as WebSocketRequest } from "websocket";
import { server as WebSocketServer } from "websocket";
import GameServer from "./GameServer.js";
import config from "@/config/gamebridge.json" with { type: "json" };
import servers from "@/config/gamebridge.servers.json" with { type: "json" };
import resoniteConfig from "@/config/resonite.json" with { type: "json" };
import pug from "pug";
import path from "path";
import nodeHtmlToImage from "node-html-to-image";

export default class GameBridge extends Service {
	name = "GameBridge";
	config = {
		servers,
		...config,
	};
	payloads = payloads;
	webApp: WebApp;
	ws: WebSocketServer;
	servers: GameServer[] = [];
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
		this.init();
	}

	private async init() {
		this.webApp = await this.container.getService("WebApp");

		this.ws = new WebSocketServer({
			httpServer: this.webApp.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			this.handleConnection(req);
		});

		console.log(`Web socket server listening on ${this.webApp.config.port}`);
		this.ready = true;
		this.handleResoniteConnection();
	}

	async handleConnection(req: WebSocketRequest): Promise<void> {
		const ip = req.httpRequest.socket.remoteAddress;
		const forwarded = req.httpRequest.headers["x-forwarded-for"]?.toString()?.split(",")[0];

		for (const connection of this.ws.connections) {
			if (ip == connection.remoteAddress) {
				console.log(
					`${ip} is trying to connect multiple times, dropping previous connection.`
				);
				connection.close();
			}
		}

		let serverConfig: GameServerConfig | undefined;
		for (const config of servers) {
			if (ip === config.ip || forwarded === config.ip) {
				serverConfig = config;
				break;
			}
		}
		if (!serverConfig) {
			console.log(`Bad IP - ${ip}`);
			return req.reject(403);
		}

		const requestToken = req.httpRequest.headers["x-auth-token"];
		if (requestToken !== config.token) {
			console.log(`Bad X-Auth-Token - ${requestToken}`);
			return req.reject(401);
		}

		this.servers[serverConfig.id] = new GameServer({
			req: req,
			bridge: this,
			serverConfig: serverConfig,
		});
	}

	async handleResoniteConnection(): Promise<void> {
		const resonite = await this.container.getService("Resonite");
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
				const server = (this.servers[id] = new GameServer({
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
			.catch();

		con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
			try {
				const server = this.servers[id];
				if (!server) throw new Error("Server not found");
				if (session.hostUserId === resonite.UserID) {
					const discord = server.discord;
					if (discord.ready) {
						const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
						if (!guild) throw new Error("Guild not found");

						const channel = guild.channels.cache.get(
							config.serverInfoChannelId
						) as Discord.TextChannel;
						if (!channel) throw new Error("Channel not found");

						const count = session.joinedUsers;

						const presence: Discord.PresenceData =
							count > 0
								? {
										status: "online",
										activities: [
											{
												name: `${count} player${count !== 1 ? "s" : ""}`,
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
									accountId: 0,
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

						const html = pug.renderFile(
							path.join(process.cwd(), "resources/game-server-status/view.pug"),
							{
								server,
								mapThumbnail,
								image: true,
							}
						);

						server.playerListImage = (await nodeHtmlToImage({
							html,
							transparent: true,
							selector: "main",
							puppeteerArgs: {
								args: ["--no-sandbox"],
							},
						})) as Buffer;

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
							channel.send({
								components: [container],
								files: [
									new Discord.AttachmentBuilder(server.playerListImage).setName(
										"players.png"
									),
								],
								flags: Discord.MessageFlags.IsComponentsV2,
							});
						}
					}
				}
			} catch (error) {
				console.log("GameBridge:Resonite", error);
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
