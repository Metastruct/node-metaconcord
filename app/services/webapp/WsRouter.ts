import { request as WebSocketRequest, server as WebSocketServer } from "websocket";
import { Server as HTTPServer } from "http";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type WsRequestHandler = (req: WebSocketRequest) => void;

/**
 * Single WebSocket server shared by every game transport, dispatching upgrade
 * requests by URL path. Mounting one WebSocketServer per game doesn't work:
 * each mounted server receives every upgrade request and a reject() from one
 * would destroy the socket for the others.
 */
export class WsRouter {
	readonly ws: WebSocketServer;
	private routes = new Map<string, WsRequestHandler>();

	constructor(httpServer: HTTPServer) {
		this.ws = new WebSocketServer({
			httpServer,
			autoAcceptConnections: false,
		});

		this.ws.on("request", req => {
			const path = req.httpRequest.url?.split("?")[0] ?? "";
			const handler = this.routes.get(path);
			if (!handler) {
				log.info(`Rejected WebSocket connection on ${req.httpRequest.url}`);
				req.reject(404);
				return;
			}
			handler(req);
		});
	}

	route(path: string, handler: WsRequestHandler): void {
		this.routes.set(path, handler);
	}
}
