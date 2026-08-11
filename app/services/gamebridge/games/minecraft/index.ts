import { request as WebSocketRequest } from "websocket";
import GameBridge from "../../GameBridge.js";
import MinecraftConnection, { MinecraftConnectionConfig } from "./MinecraftConnection.js";
import { WsRouter } from "../../WsRouter.js";
import config from "@/config/minecraft.json" with { type: "json" };
import servers from "@/config/minecraft.servers.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

function handleConnection(bridge: GameBridge, req: WebSocketRequest): void {
	const ip = req.httpRequest.socket.remoteAddress;
	const forwarded =
		req.httpRequest.headers["cf-connecting-ip"]?.toString() ??
		req.httpRequest.headers["x-forwarded-for"]?.toString()?.split(",")[0];

	let serverConfig: MinecraftConnectionConfig | undefined;
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

	const existing = bridge.servers[serverConfig.id];
	if (existing instanceof MinecraftConnection) {
		log.info(`'${serverConfig.name}' is reconnecting, dropping previous connection.`);
		existing.wsConnection?.close();
	}

	bridge.servers[serverConfig.id] = new MinecraftConnection({
		req,
		bridge,
		serverConfig,
	});
}

export function attachMinecraft(bridge: GameBridge, router: WsRouter): void {
	router.route("/minecraft/ws", req => handleConnection(bridge, req));
}
