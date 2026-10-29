import { type Container, type Service } from "#/app/Container.js";
import GameBridge from "./GameBridge.js";
export default function GameBridgeProvider(container: Container): Service {
	return new GameBridge(container);
}

export {DiscordClient} from "./discord/index.js";
export {default as GameConnection, type GameConnectionConfig, type Player} from "./GameConnection.js";
export {default as GameBridge} from "./GameBridge.js";
