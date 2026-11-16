import { type Container } from "#/app/Container.ts";
import { type Service } from "#/app/Service.ts";
import GameBridge from "./GameBridge.ts";

export default function GameBridgeProvider(container: Container): Service {
	return new GameBridge(container);
}

export {DiscordClient} from "./discord/index.ts";
export {default as GameConnection, type GameConnectionConfig, type Player} from "./GameConnection.ts";
export {default as GameBridge} from "./GameBridge.ts";
