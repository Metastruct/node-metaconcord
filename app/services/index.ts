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
import DiscordMetadataProvider, { DiscordMetadata } from "./DiscordMetadata";
import GameBridgeProvider, { GameBridge } from "./gamebridge";
import IRCProvider, { IRC } from "./IRC";
import MarkovProvider, { Markov } from "./Markov";
import MotdProvider, { Motd } from "./Motd";
import ResoniteProvider, { Resonite } from "./Resonite";
import SQLProvider, { SQL } from "./SQL";
import StarboardProvider, { Starboard } from "./Starboard";
import SteamProvider, { Steam } from "./Steam";
import TenorProvider, { Tenor } from "./Tenor";
import WebAppProvider, { WebApp } from "./webapp";

export default [
	SQLProvider,
	MarkovProvider,
	SteamProvider,
	DataProvider,
	BanProvider,
	WebAppProvider,
	ResoniteProvider,
	GameBridgeProvider,
	DiscordBotProvider,
	DiscordMetadataProvider,
	MotdProvider,
	StarboardProvider,
	TenorProvider,
	IRCProvider,
]; // The order is important

export {
	SQL,
	Markov,
	Data,
	Resonite,
	DiscordBot,
	GameBridge,
	Bans,
	Steam,
	DiscordMetadata,
	Tenor,
	WebApp,
	Motd,
	IRC,
};

export type ServiceMap = {
	[key: string]: Service;
	Bans: Bans;
	Data: Data;
	DiscordBot: DiscordBot;
	DiscordMetadata: DiscordMetadata;
	GameBridge: GameBridge;
	IRC: IRC;
	Markov: Markov;
	Motd: Motd;
	Resonite: Resonite;
	SQL: SQL;
	Starboard: Starboard;
	Steam: Steam;
	Tenor: Tenor;
	WebApp: WebApp;
};
