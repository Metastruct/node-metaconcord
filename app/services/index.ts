import { Container } from "@/app/Container";

export class Service {
	readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}
}

import DataProvider, { Data } from "./Data";
import DiscordBotProvider, { DiscordBot } from "./discord";
import GameBridgeProvider, { GameBridge } from "./gamebridge";
import SteamProvider, { Steam } from "./Steam";
import WebAppProvider, { WebApp } from "./webapp";
import MotdProvider, { Motd } from "./motd";

export default [
	SteamProvider,
	DataProvider,
	DiscordBotProvider,
	WebAppProvider,
	GameBridgeProvider,
	MotdProvider,
]; // The order is important
export { Data, DiscordBot, GameBridge, Steam, WebApp, Motd };
export type ServiceMap = {
	[key: string]: Service;
	Data?: Data;
	DiscordBot?: DiscordBot;
	GameBridge?: GameBridge;
	Steam?: Steam;
	WebApp?: WebApp;
	Motd?: Motd;
};
