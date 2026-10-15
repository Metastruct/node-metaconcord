import GameBridge from "./GameBridge.js";

import { Container, Service } from "#/app/Container.js";
export default (container: Container): Service => {
	return new GameBridge(container);
};

export {DiscordClient} from "./discord/index.js";
export {default as GameConnection, type GameConnectionConfig, type Player} from "./GameConnection.js";
export {default as GameBridge} from "./GameBridge.js";
