import "@/extensions/websocket";
import * as config from "@/gamebridge.config.json";
import * as payloads from "./payloads";
import { DiscordClient } from "./index";
import { Server as HTTPServer } from "http";
import { connection as WebSocketConnection } from "websocket";
import { server as WebSocketServer } from "websocket";

export default class Server {
	public name = "GameBridge";
	public config = config;
	public payloads = payloads;

	public http: HTTPServer;
	public ws: WebSocketServer;
	public discord: { [ip: string]: DiscordClient } = {};

	public constructor(http: HTTPServer) {
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
			const bot = this.getBot(ip, connection);
			bot.run();
			connection.on("message", async received => {
				// if (received.utf8Data == "") console.log("Heartbeat");
				if (!received.utf8Data || received.utf8Data == "") return;

				let data;
				try {
					data = JSON.parse(received.utf8Data);
				} catch (e) {
					return connection.sendPayload("ErrorPayload", {
						error: { message: "Malformed JSON" },
					});
				}

				let payloadRequest;
				try {
					payloadRequest = data.payload;
				} catch (err) {
					return connection.sendPayload("ErrorPayload", {
						error: { message: "Missing payload" },
					});
				}

				try {
					for (const [name, type] of Object.entries(this.payloads)) {
						if (payloadRequest.name === name) {
							const payload = new type(connection, this);
							return payload.handle(req, payloadRequest);
						}
					}
				} catch (err) {
					console.log(payloadRequest);
					console.error(`${data.payload.name} exception:`, err);
				}

				connection.sendPayload("ErrorPayload", {
					message: "Payload doesn't exist, nothing to do",
				});
			});
			connection.on("close", (code, desc) => {
				bot.kill();
				delete this.discord[ip];
				console.log("Client disconnected", code, desc);
			});
		});
	}

	public getBot(ip: string, connection: WebSocketConnection): DiscordClient {
		const bot = (this.discord[ip] = new DiscordClient(
			config.servers.filter(server => server.ip == ip)[0].discordToken,
			connection,
			this
		));
		return bot;
	}
}
