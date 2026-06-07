import { DiscordClient } from "./discord/index.js";
import GameBridge from "./GameBridge.js";
import GameServer, { GameServerConfig, Player } from "./GameServer.js";
export { DiscordClient, GameServer, GameBridge, GameServerConfig, Player };

import { Container, Service } from "@/app/Container.js";
export default async (container: Container): Promise<Service> => {
	const svc = new GameBridge(container);
	await svc.init();
	return svc;
};
