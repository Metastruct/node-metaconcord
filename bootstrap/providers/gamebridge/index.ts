import { DiscordClient } from "./discord";
import GameBridge from "./GameBridge";
export { DiscordClient, GameBridge };

import { Container } from "../../Container";
import { IService } from "../../providers";
import { WebApp } from "../WebApp";
export default (container: Container): IService => {
	return new GameBridge(container.getService(WebApp).server);
};
