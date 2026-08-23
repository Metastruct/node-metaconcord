import GameBridge from "../../GameBridge.js";
import GmodConnection, { GmodConnectionConfig } from "./GmodConnection.js";
import GmodStatsProbe from "./GmodStatsProbe.js";
import { WsRouter } from "@/app/services/webapp/WsRouter.js";
import { attachWsGame } from "../../attachWsGame.js";
import servers from "@/config/gmod.servers.json" with { type: "json" };

export const statsProbes = new Map<number, GmodStatsProbe>();

export function attachGmod(bridge: GameBridge, router: WsRouter): void {
	for (const serverConfig of servers as GmodConnectionConfig[]) {
		if (!serverConfig.ssh) continue;
		const probe = new GmodStatsProbe(bridge, serverConfig);
		statsProbes.set(serverConfig.id, probe);
		probe.start();
	}
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
