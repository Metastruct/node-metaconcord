import GameBridge from "../../GameBridge.js";
import MinecraftConnection, { MinecraftConnectionConfig } from "./MinecraftConnection.js";
import { WsRouter } from "@/app/services/webapp/WsRouter.js";
import { attachWsGame } from "../../attachWsGame.js";
import servers from "@/config/minecraft.servers.json" with { type: "json" };

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
