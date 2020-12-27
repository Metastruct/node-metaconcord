import WebApp from "./WebApp";
export { WebApp };

import { Container } from "../../Container";
import { DiscordBot } from "../discord";
import { IService } from "..";
export default (container: Container): IService => {
	return new WebApp(container.getService(DiscordBot).discord);
};
