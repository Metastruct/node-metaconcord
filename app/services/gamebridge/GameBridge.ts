import "@/extensions/websocket";
import * as payloads from "./payloads";
import { Container } from "@/app/Container";
import { GameServerConfig } from "./GameServer";
import { Service } from "@/app/services";
import { WebApp } from "@/app/services/webapp";
import { request as WebSocketRequest } from "websocket";
import { server as WebSocketServer } from "websocket";
import GameServer from "./GameServer";
import config from "@/gamebridge.json";
import servers from "@/gamebridge.servers.json";

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

		this.webApp = container.getService("WebApp");
		this.ws = new WebSocketServer({
			httpServer: this.webApp.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			this.handleConnection(req);
		});

		console.log(`Web socket server listening on ${this.webApp.config.port}`);
	}

	async handleConnection(req: WebSocketRequest): Promise<void> {
		const ip = req.httpRequest.connection.remoteAddress;

		for (const connection of this.ws.connections) {
			if (ip == connection.remoteAddress) {
				console.log(
					`${ip} is trying to connect multiple times, dropping previous connection.`
				);
				connection.close();
			}
		}

		let serverConfig: GameServerConfig;
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

		this.servers[serverConfig.id] = new GameServer(req, this, serverConfig);
	}
}
