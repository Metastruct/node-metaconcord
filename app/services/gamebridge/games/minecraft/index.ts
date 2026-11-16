import { type WsRouter } from "#/app/services/webapp/WsRouter.ts";
import { attachWsGame } from "../../attachWsGame.ts";
import type GameBridge from "../../GameBridge.ts";
import MinecraftConnection, { type MinecraftConnectionConfig } from "./MinecraftConnection.ts";

import servers from "#config/minecraft.servers.json" with { type: "json" };

export function attachMinecraft(bridge: GameBridge, router: WsRouter): void {
	attachWsGame<MinecraftConnectionConfig, MinecraftConnection>({
		bridge,
		router,
		path: "/minecraft/ws",
		servers,
		ownServerList: bridge.servers.minecraft,
		create: ({ req, bridge, serverConfig }) =>
			new MinecraftConnection({ req, bridge, serverConfig }),
	});
}
