import DiscordClient from "./DiscordClient";
import Server from "./Server";
export { DiscordClient, Server };

import { Container, IService } from "../../container";
import { WebApp } from "../webapp";
export default (container: Container): IService => {
	return new Server(container.getService(WebApp).server);
};
