import * as payloads from "./payloads";
import * as signalR from "@microsoft/signalr";
import { Container } from "@/app/Container";
import { GameServerConfig } from "./GameServer";
import { ResoniteSession } from "../Resonite";
import { Service } from "@/app/services";
import { WebApp } from "@/app/services/webapp";
import { request as WebSocketRequest } from "websocket";
import { server as WebSocketServer } from "websocket";
import Discord from "discord.js";
import GameServer from "./GameServer";
import config from "@/config/gamebridge.json";
import servers from "@/config/gamebridge.servers.json";

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

	constructor(container: Container) {
		super(container);

		const webApp = container.getService("WebApp");
		if (!webApp) return;
		this.webApp = webApp;
		this.ws = new WebSocketServer({
			httpServer: this.webApp.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			this.handleConnection(req);
		});

		console.log(`Web socket server listening on ${this.webApp.config.port}`);
		this.handleResoniteConnection();
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
		const resonite = this.container.getService("Resonite");
		if (!resonite) return;
		const id = 9;

		const con = new signalR.HubConnectionBuilder()
			.withUrl("https://api.resonite.com/hub", {
				headers: { Authorization: `res ${resonite.UserID}:${resonite.ResoniteToken}` },
			})
			.configureLogging(signalR.LogLevel.Error)
			.build();

		con.start()
			.then(() => {
				const server = (this.servers[id] = new GameServer({
					bridge: this,
					serverConfig: servers.find(s => s.id === id) as GameServerConfig,
				}));
				server.discord.on("ready", client => {
					server.changeIcon(
						"https://gitlab.com/metastruct/branding/-/raw/master/icons/seagull_vr.png?&inline=true"
					);
					if (server.status.mapThumbnail) server.changeBanner(server.status.mapThumbnail);
				});
			})
			.catch();

		con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
			const server = this.servers[9];
			if (!server) return;
			const discord = server.discord;
			if (session.hostUserId === config.resonite.userID) {
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
									activities: [
										{
											name: `${count} player${count !== 1 ? "s" : ""}`,
											type: 3,
										},
									],
							  }
							: {
									afk: true,
							  };

					discord.user?.setPresence(presence);

					server.status.mapThumbnail = session.thumbnailUrl;

					server.status.players = session.sessionUsers.map(sessionUser => {
						return {
							nick: sessionUser.username,
							isAfk: !sessionUser.isPresent,
							accountId: 0,
							isAdmin: false,
							isBanned: false,
							ip: sessionUser.userID,
						};
					});

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
							url: `https://go.resonite.com/sessions/${session.sessionId}`,
						},
						thumbnail: { url: session.thumbnailUrl },
						image: {
							url: `http://${server.bridge.webApp.config.host}:${
								server.bridge.webApp.config.port
							}/server-status/${server.config.id}/${Date.now()}`,
						},
						footer: {
							text: "metastruct @ Resonite",
						},
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
