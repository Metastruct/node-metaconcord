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
	public discord: { [host: string]: DiscordClient } = {};

	public constructor(http: HTTPServer) {
		for (const server of config.servers) {
			this.discord[server.host] = new DiscordClient(server.discordToken);
		}

		this.http = http;
		this.ws = new WebSocketServer({
			httpServer: this.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			let validHost = false;
			for (const server of Object.values(config.servers)) {
				if (req.host === server.host) {
					validHost = true;
					break;
				}
			}
			if (!validHost) {
				console.log("Bad host");
				return req.reject(403);
			}
			if (req.httpRequest.headers["x-auth-token"] !== config.token) {
				console.log("Bad Authorization");
				return req.reject(401);
			}
			console.log("New connection");

			const connection = req.accept();
			const bot = this.getBotForHost(req.host);
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

	public getBotForHost(host: string): DiscordClient {
		return this.discord[host];
	}
}

export default (container: Container): IService => {
	return new GameBridgeServer(container.getService(WebApp).server);
};
