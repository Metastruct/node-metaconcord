export interface IService {
	name: string;
}

import Data from "./Data";
import DiscordBot from "./discord";
import GameBridge from "./gamebridge";
import Steam from "./Steam";
import WebApp from "./WebApp";

export default [Steam, Data, DiscordBot, WebApp, GameBridge]; // The order is important
