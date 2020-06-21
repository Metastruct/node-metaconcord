import DiscordClient from "./DiscordClient";
import Server from "./Server";
export { DiscordClient, Server };

import { Container, IService } from "../../Container";
import { WebApp } from "../WebApp";
export default (container: Container): IService => {
	return new Server(container.getService(WebApp).server);
};
