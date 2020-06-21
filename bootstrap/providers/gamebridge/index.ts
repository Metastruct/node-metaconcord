import "@/extensions/websocket";
import * as config from "@/gamebridge.config.json";
import { Container, IService } from "../../container";
import { DiscordClient } from "../discord/client";
import { Server as HTTPServer } from "http";
import { WebApp } from "../webapp";
import { server as WebSocketServer } from "websocket";
import { payloads } from "./payloads";

export class GameBridgeServer implements IService {
	public name = "GameBridge";
	public config = config;
	public payloads = payloads;

	public http: HTTPServer;
	public ws: WebSocketServer;
	public discord: { [ip: string]: DiscordClient } = {};

	public constructor(http: HTTPServer) {
		for (const server of config.servers) {
			this.discord[server.ip] = new DiscordClient(server.discordToken);
		}

		this.http = http;
		this.ws = new WebSocketServer({
			httpServer: this.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			let validIP = false;
			const ip = req.httpRequest.connection.remoteAddress;
			for (const server of Object.values(config.servers)) {
				if (ip === server.ip) {
					validIP = true;
					break;
				}
			}
			if (!validIP) {
				console.log();
				console.log(`Bad IP - ${ip}`);
				return req.reject(403);
			}
			const requestToken = req.httpRequest.headers["x-auth-token"];
			if (requestToken !== config.token) {
				console.log(`Bad X-Auth-Token - ${requestToken}`);
				return req.reject(401);
			}
			console.log("New connection");

			const connection = req.accept();
			const bot = this.getBotForIP(ip);
			bot.run();
			connection.on("message", async received => {
				// if (received.utf8Data == "") console.log("Heartbeat");
				if (!received.utf8Data || received.utf8Data == "") return;

				let data;
				try {
					data = JSON.parse(received.utf8Data);
				} catch (e) {
					return connection.sendError({
						message: "Malformed JSON",
					});
				}

				let payloadRequest;
				try {
					payloadRequest = data.payload;
				} catch (err) {
					return connection.sendError({
						message: "Missing payload",
					});
				}

				try {
					for (const [name, type] of Object.entries(this.payloads)) {
						if (payloadRequest.name === name) {
							const payload = new type(connection, req, this);
							return payload.handle(payloadRequest);
						}
					}
				} catch (err) {
					console.log(payloadRequest);
					console.error(`${data.payload.name} exception:`, err);
				}

				connection.sendError({
					message: "Payload doesn't exist, nothing to do",
				});
			});
			connection.on("close", (code, desc) => {
				bot.kill();
				console.log("Client disconnected", code, desc);
			});
		});
	}

	public getBotForIP(ip: string): DiscordClient {
		return this.discord[ip];
	}
}

export default (container: Container): IService => {
	return new GameBridgeServer(container.getService(WebApp).server);
};
