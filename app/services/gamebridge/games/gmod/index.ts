import { request as WebSocketRequest, server as WebSocketServer } from "websocket";
import GameBridge from "../../GameBridge.js";
import GmodConnection, { GmodConnectionConfig } from "./GmodConnection.js";
import config from "@/config/gamebridge.json" with { type: "json" };
import servers from "@/config/gamebridge.servers.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

function handleConnection(bridge: GameBridge, ws: WebSocketServer, req: WebSocketRequest): void {
	if (req.httpRequest.url !== "/ws") {
		log.info(`Rejected WebSocket connection on ${req.httpRequest.url}`);
		req.reject(404);
		return;
	}

	const ip = req.httpRequest.socket.remoteAddress;
	const forwarded =
		req.httpRequest.headers["cf-connecting-ip"]?.toString() ??
		req.httpRequest.headers["x-forwarded-for"]?.toString()?.split(",")[0];

	for (const connection of ws.connections) {
		if (ip == connection.remoteAddress) {
			log.info(`${ip} is trying to connect multiple times, dropping previous connection.`);
			connection.close();
		}
	}

	let serverConfig: GmodConnectionConfig | undefined;
	for (const serverEntry of servers) {
		const ips = serverEntry.ip
			? Array.isArray(serverEntry.ip)
				? serverEntry.ip
				: [serverEntry.ip]
			: [];
		if ((ip && ips.includes(ip)) || (forwarded && ips.includes(forwarded))) {
			serverConfig = serverEntry;
			break;
		}
	}
	if (!serverConfig) {
		log.info(`Bad IP - socket: ${ip}, forwarded: ${forwarded}`);
		req.reject(403);
		return;
	}

	const requestToken = req.httpRequest.headers["x-auth-token"];
	if (requestToken !== config.token) {
		log.info(`Bad X-Auth-Token - ${requestToken}`);
		req.reject(401);
		return;
	}

	bridge.servers[serverConfig.id] = new GmodConnection({
		req,
		bridge,
		serverConfig,
	});
}

export function attachGmod(bridge: GameBridge): void {
	const ws = new WebSocketServer({
		httpServer: bridge.webApp.http,
		autoAcceptConnections: false,
	});

	ws.on("request", req => handleConnection(bridge, ws, req));

	log.info(`Web socket server listening on ${bridge.webApp.config.port}`);
}
