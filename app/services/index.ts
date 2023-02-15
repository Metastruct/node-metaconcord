import { Container } from "@/app/Container";

export class Service {
	readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}
}
import BanProvider, { Bans } from "./Bans";
import DataProvider, { Data } from "./Data";
import DiscordBotProvider, { DiscordBot } from "./discord";
import GameBridgeProvider, { GameBridge } from "./gamebridge";
import IRCProvider, { IRC } from "./IRC";
import MarkovProvider, { MarkovService } from "./Markov";
import MotdProvider, { Motd } from "./motd";
import SQLProvider, { SQL } from "./SQL";
import StarboardProvider, { Starboard } from "./Starboard";
import SteamProvider, { Steam } from "./Steam";
import WebAppProvider, { WebApp } from "./webapp";

export default [
	SQLProvider,
	MarkovProvider,
	SteamProvider,
	DataProvider,
	DiscordBotProvider,
	BanProvider,
	WebAppProvider,
	GameBridgeProvider,
	MotdProvider,
	StarboardProvider,
	IRCProvider,
]; // The order is important
export { SQLProvider, Data, DiscordBot, GameBridge, Bans, Steam, WebApp, Motd, IRC };
export type ServiceMap = {
	[key: string]: Service | undefined;
	Data?: Data;
	DiscordBot?: DiscordBot;
	GameBridge?: GameBridge;
	Bans?: Bans;
	Steam?: Steam;
	WebApp?: WebApp;
	Motd?: Motd;
	Markov?: MarkovService;
	Starboard?: Starboard;
	SQL?: SQL;
	IRC?: IRC;
};
