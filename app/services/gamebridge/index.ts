import { DiscordClient } from "./discord";
import GameBridge from "./GameBridge";
import GameServer from "./GameServer";
export { DiscordClient, GameServer, GameBridge };

import { Container } from "../../Container";
import { IService } from "..";
import { WebApp } from "../webapp";
export default (container: Container): IService => {
	return new GameBridge(container.getService(WebApp));
};
