import { request as WebSocketRequest } from "websocket";
import GameBridge from "./GameBridge.js";
import { GameConnectionConfig } from "./GameConnection.js";
import GameSocketConnection from "./GameSocketConnection.js";
import { WsRouter } from "@/app/services/webapp/WsRouter.js";
import config from "@/config/gamebridge.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

/**
 * Wires a websocket-backed game up to the shared {@link WsRouter}: resolves
 * the connecting server by IP against its `*.servers.json`, checks the
 * shared auth token, drops any previous connection already occupying that
 * server's slot, and stores the new one. Shared by every game transported
 * over the addon's own websocket (Gmod, Minecraft) so none of them have to
 * re-implement the handshake.
 */
export function attachWsGame<
	TConfig extends GameConnectionConfig & { ip?: string | string[] },
	TConn extends GameSocketConnection,
>(opts: {
	bridge: GameBridge;
	router: WsRouter;
	path: string;
	servers: TConfig[];
	ownServerList: TConn[];
	create: (args: { req: WebSocketRequest; bridge: GameBridge; serverConfig: TConfig }) => TConn;
}): void {
	opts.router.route(opts.path, req => {
		const ip = req.httpRequest.socket.remoteAddress;
		const forwarded =
			req.httpRequest.headers["cf-connecting-ip"]?.toString() ??
			req.httpRequest.headers["x-forwarded-for"]?.toString()?.split(",")[0];

		let serverConfig: TConfig | undefined;
		for (const serverEntry of opts.servers) {
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

		const existing = opts.ownServerList[serverConfig.id];
		if (existing) {
			log.info(`'${serverConfig.name}' is reconnecting, dropping previous connection.`);
			existing.wsConnection?.close();
		}

		opts.ownServerList[serverConfig.id] = opts.create({
			req,
			bridge: opts.bridge,
			serverConfig,
		});
	});
}
