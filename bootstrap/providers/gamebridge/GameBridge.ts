import "@/extensions/websocket";
import * as config from "@/gamebridge.config.json";
import * as payloads from "./payloads";
import { DiscordClient } from "./index";
import { ErrorPayload } from "./payloads";
import { ErrorResponse } from "./payloads/structures";
import { Server as HTTPServer } from "http";
import { connection as WebSocketConnection } from "websocket";
import { server as WebSocketServer } from "websocket";

export default class GameBridge {
	name = "GameBridge";
	config = config;
	payloads = payloads;

	http: HTTPServer;
	ws: WebSocketServer;
	discord: { [ip: string]: DiscordClient } = {};

	constructor(http: HTTPServer) {
		this.http = http;
		this.ws = new WebSocketServer({
			httpServer: this.http,
			autoAcceptConnections: false,
		});

		this.ws.on("request", async req => {
			let validIP = false;
			const ip = req.httpRequest.connection.remoteAddress;
			for (const connection of this.ws.connections) {
				if (ip == connection.remoteAddress) {
					console.log(
						`${ip} is trying to connect multiple times, dropping previous connection.`
					);
					connection.close();
				}
			}
			for (const server of Object.values(config.servers)) {
				if (ip === server.ip) {
					validIP = true;
					break;
				}
			}
			if (!validIP) {
				console.log(`Bad IP - ${ip}`);
				return req.reject(403);
			}
			const requestToken = req.httpRequest.headers["x-auth-token"];
			if (requestToken !== config.token) {
				console.log(`Bad X-Auth-Token - ${requestToken}`);
				return req.reject(401);
			}
			console.log(`New connection from ${ip}`);

			const connection = req.accept();
			const bot = this.getBot(ip, connection);

			await bot.run();
			connection.on("message", async received => {
				// if (received.utf8Data == "") console.log("Heartbeat");
				if (!received.utf8Data || received.utf8Data == "") return;

				let data;
				try {
					data = JSON.parse(received.utf8Data);
				} catch (e) {
					return new ErrorPayload(bot).send({
						error: { message: "Malformed JSON" },
					} as ErrorResponse);
				}

				let payloadRequest;
				try {
					payloadRequest = data.payload;
				} catch (err) {
					return new ErrorPayload(bot).send({
						error: { message: "Missing payload" },
					} as ErrorResponse);
				}

				try {
					for (const [name, type] of Object.entries(this.payloads)) {
						if (payloadRequest.name === name) {
							const payload = new type(bot);
							return payload.handle(req, payloadRequest);
						}
					}
				} catch (err) {
					console.log(payloadRequest);
					console.error(`${data.payload.name} exception:`, err);
					return;
				}

				console.log("Invalid payload:");
				console.log(payloadRequest?.name, payloadRequest);
				new ErrorPayload(bot).send({
					error: { message: "Payload doesn't exist, nothing to do" },
				} as ErrorResponse);
			});
			connection.on("close", (code, desc) => {
				bot.kill();
				delete this.discord[ip];
				console.log("Client disconnected", code, desc);
			});
		});
	}

	getBot(ip: string, connection: WebSocketConnection): DiscordClient {
		if (!this.discord[ip]) {
			const config = this.config.servers.filter(server => server.ip == ip)[0];
			this.discord[ip] = new DiscordClient(config, connection, this);
		}
		return this.discord[ip];
	}
}
