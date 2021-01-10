import { DiscordClient } from "./discord";
import GameBridge from "./GameBridge";
import GameServer from "./GameServer";
export { DiscordClient, GameServer, GameBridge };

import { Container } from "@/app/Container";
import { Service } from "@/app/services";
export default (container: Container): Service => {
	return new GameBridge(container);
};
