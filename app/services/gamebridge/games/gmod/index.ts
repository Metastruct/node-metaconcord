import type { WsRouter } from "#/app/services/webapp/WsRouter.ts";
import { attachWsGame } from "../../attachWsGame.ts";
import type GameBridge from "../../GameBridge.ts";
import GmodConnection, { type GmodConnectionConfig } from "./GmodConnection.ts";

import servers from "#config/gmod.servers.json" with { type: "json" };

export function attachGmod(bridge: GameBridge, router: WsRouter): void {
	attachWsGame<GmodConnectionConfig, GmodConnection>({
		bridge,
		router,
		path: "/gmod/ws",
		servers,
		ownServerList: bridge.servers.gmod,
		create: ({ req, bridge, serverConfig }) =>
			new GmodConnection({ req, bridge, serverConfig }),
	});
}
