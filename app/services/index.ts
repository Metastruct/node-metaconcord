import { Service } from "../Container.js";
import BanProvider, { Bans } from "./Bans.js";
import DataProvider, { Data } from "./Data.js";
import DiscordBotProvider, { DiscordBot } from "./discord/index.js";
import DiscordMetadataProvider, { DiscordMetadata } from "./DiscordMetadata.js";
import GameBridgeProvider, { GameBridge } from "./gamebridge/index.js";
import GithubProvider, { Github } from "./Github.js";
import GitlabProvider, { Gitlab } from "./Gitlab.js";
import IRCProvider, { IRC } from "./IRC.js";
import MarkovProvider, { Markov } from "./Markov.js";
import MotdProvider, { Motd } from "./Motd.js";
import ResoniteProvider, { Resonite } from "./Resonite.js";
import SQLProvider, { SQL } from "./SQL.js";
import StarboardProvider, { Starboard } from "./Starboard.js";
import SteamProvider, { Steam } from "./Steam.js";
import TenorProvider, { Tenor } from "./Tenor.js";
import WebAppProvider, { WebApp } from "./webapp/index.js";

export default [
	BanProvider,
	DataProvider,
	DiscordBotProvider,
	DiscordMetadataProvider,
	GameBridgeProvider,
	GithubProvider,
	GitlabProvider,
	IRCProvider,
	MarkovProvider,
	MotdProvider,
	ResoniteProvider,
	SQLProvider,
	StarboardProvider,
	SteamProvider,
	TenorProvider,
	WebAppProvider,
];

export {
	Bans,
	Data,
	DiscordBot,
	DiscordMetadata,
	GameBridge,
	Github,
	Gitlab,
	IRC,
	Markov,
	Motd,
	Resonite,
	SQL,
	Steam,
	Tenor,
	WebApp,
};

export type ServiceMap = {
	[key: string]: Service;
	Bans: Bans;
	Data: Data;
	DiscordBot: DiscordBot;
	DiscordMetadata: DiscordMetadata;
	GameBridge: GameBridge;
	Github: Github;
	Gitlab: Gitlab;
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
