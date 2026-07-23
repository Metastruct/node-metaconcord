import { DiscordClient } from "./discord/index.js";
import GameBridge from "./GameBridge.js";
import GameConnection, { GameConnectionConfig, Player } from "./GameConnection.js";
export { DiscordClient, GameConnection, GameBridge, GameConnectionConfig, Player };

import { Container, Service } from "@/app/Container.js";
export default (container: Container): Service => {
	return new GameBridge(container);
};
