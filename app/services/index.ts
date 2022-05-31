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
import IRCProvider, { IRC } from "./IRC";
// import MarkovProvider, { MarkovService } from "./Markov";
import MotdProvider, { Motd } from "./motd";
import SqlProvider, { Sql } from "./Sql";
import StarboardProvider, { Starboard } from "./Starboard";
import SteamProvider, { Steam } from "./Steam";
import TwitterProvider, { Twitter } from "./Twitter";
import WebAppProvider, { WebApp } from "./webapp";

export default [
	SqlProvider,
	// MarkovProvider,
	SteamProvider,
	DataProvider,
	DiscordBotProvider,
	WebAppProvider,
	GameBridgeProvider,
	MotdProvider,
	TwitterProvider,
	StarboardProvider,
	IRCProvider,
]; // The order is important
export { SqlProvider, Data, DiscordBot, GameBridge, Steam, WebApp, Motd, Twitter, IRC };
export type ServiceMap = {
	[key: string]: Service;
	Data?: Data;
	DiscordBot?: DiscordBot;
	GameBridge?: GameBridge;
	Steam?: Steam;
	WebApp?: WebApp;
	Motd?: Motd;
	Twitter?: Twitter;
	// Markov?: MarkovService;
	Starboard?: Starboard;
	Sql?: Sql;
	IRC?: IRC;
};
