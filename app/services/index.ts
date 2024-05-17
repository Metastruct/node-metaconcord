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
import HuggingfaceProvider, { Huggingface } from "./Huggingface";
import IRCProvider, { IRC } from "./IRC";
import MarkovProvider, { Markov } from "./Markov";
import MotdProvider, { Motd } from "./Motd";
import SQLProvider, { SQL } from "./SQL";
import StarboardProvider, { Starboard } from "./Starboard";
import SteamProvider, { Steam } from "./Steam";
import TenorProvider, { Tenor } from "./Tenor";
import WebAppProvider, { WebApp } from "./webapp";

export default [
	SQLProvider,
	MarkovProvider,
	HuggingfaceProvider,
	SteamProvider,
	DataProvider,
	BanProvider,
	WebAppProvider,
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
	Huggingface,
	Data,
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
	[key: string]: Service | undefined;
	Data?: Data;
	DiscordBot?: DiscordBot;
	GameBridge?: GameBridge;
	Huggingface?: Huggingface;
	Bans?: Bans;
	Steam?: Steam;
	DiscordMetadata?: DiscordMetadata;
	WebApp?: WebApp;
	Motd?: Motd;
	Markov?: Markov;
	Starboard?: Starboard;
	Tenor?: Tenor;
	SQL?: SQL;
	IRC?: IRC;
};
