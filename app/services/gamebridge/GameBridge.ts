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
	discordChatWH: Discord.WebhookClient;
	discordErrorWH: Discord.WebhookClient;
	discordPacErrorWH: Discord.WebhookClient;
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
		this.discordChatWH = new Discord.WebhookClient({
			url: config.chatWebhookUrl,
		});
		this.discordErrorWH = new Discord.WebhookClient({
			url: config.errorWebhookUrl,
		});
		this.discordPacErrorWH = new Discord.WebhookClient({
			url: config.pacErrorWebhookUrl,
		});

		this.ws.on("request", req => {
			this.handleConnection(req);
		});

		console.log(`Web socket server listening on ${this.webApp.config.port}`);
		this.ready = true;
		// this.handleResoniteConnection();
	}

	async handleConnection(req: WebSocketRequest): Promise<void> {
		const ip = req.httpRequest.socket.remoteAddress;

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
			if (ip === config.ip) {
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
					serverConfig: servers.find(s => s.id === id) as GameServerConfig,
				}));
				server.discord.on("ready", () => {
					server.changeIcon(
						"https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull_resonite.png?&inline=true"
					);
					if (server.status.mapThumbnail) server.changeBanner(server.status.mapThumbnail);
				});
			})
			.catch();

		con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
			const server = this.servers[id];
			if (!server) return;
			if (session.hostUserId === resonite.UserID) {
				const discord = server.discord;
				if (discord.ready) {
					const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
					if (!guild) return;
					const channel = guild.channels.cache.get(
						config.serverInfoChannelId
					) as Discord.TextChannel;
					if (!channel) return;

					const count = session.activeUsers;

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

					server.status.mapThumbnail = session.thumbnailUrl;

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

					const embed: Discord.APIEmbed = {
						title: session.name,
						description: `:busts_in_silhouette: **${count > 0 ? count : "no"} player${
							count > 1 || count == 0 ? "s" : ""
						}**\n:repeat: <t:${
							(new Date(session.lastUpdate).getTime() / 1000) | 0
						}:R>\n:file_cabinet: <t:${
							(new Date(session.sessionBeginTime).getTime() / 1000) | 0
						}:R>`,
						color: 4796260,
						author: {
							name: server.config.name,
							icon_url: server.discordIcon,
							url: `https://go.resonite.com/session/${session.sessionId}`,
						},
						thumbnail: { url: session.thumbnailUrl },
						footer: {
							text: "metastruct @ Resonite",
						},
					};

					if (server.status.players.length > 0)
						embed.image = {
							url: `http://${server.bridge.webApp.config.host}:${
								server.bridge.webApp.config.port
							}/server-status/${server.config.id}/${Date.now()}`,
						};

					const messages = await channel.messages.fetch();
					const message = messages
						.filter((msg: Discord.Message) => msg.author.id == discord.user?.id)
						.first();
					if (message) {
						await message.edit({ embeds: [embed] }).catch();
					} else {
						channel.send({ embeds: [embed] }).catch();
					}
				}
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
