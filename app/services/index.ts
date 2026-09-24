import { Container, Service } from "../Container.js";
import AccountsProvider, { Accounts } from "./Accounts.js";
import AddonsProvider, { Addons } from "./addons/index.js";
import BanProvider, { Bans } from "./Bans.js";
import DataProvider, { Data } from "./Data.js";
import DiscordBotProvider, { DiscordBot } from "./discord/index.js";
import DiscordMetadataProvider, { DiscordMetadata } from "./DiscordMetadata.js";
import FluxerProvider, { Fluxer } from "./fluxer/index.js";
import GameBridgeProvider, { GameBridge } from "./gamebridge/index.js";
import GithubProvider, { Github } from "./Github.js";
import GitlabProvider, { Gitlab } from "./Gitlab.js";
import IRCProvider, { IRC } from "./IRC.js";
import MarkovProvider, { Markov } from "./Markov.js";
import MotdProvider, { Motd } from "./Motd.js";
import OIDCProvider, { OIDC } from "./OIDC.js";
import ResoniteProvider, { Resonite } from "./Resonite.js";
import SQLProvider, { SQL } from "./SQL.js";
import StarboardProvider, { Starboard } from "./Starboard.js";
import SteamProvider, { Steam } from "./Steam.js";
import WebAppProvider, { WebApp } from "./webapp/index.js";

type Provider = (container: Container) => Service;
/** A provider tagged with the service name it constructs (factories are anonymous). */
type Entry = { name: string; provider: Provider };
const svc = (name: string, provider: Provider): Entry => ({ name, provider });

/**
 * Service groups, ordered so every service comes after its hard requirements.
 * A run enables a subset of these (see selectServices) and production uses all.
 */
export const SERVICE_GROUPS = {
	infra: [svc("SQL", SQLProvider), svc("Data", DataProvider), svc("Bans", BanProvider)],
	web: [
		svc("WebApp", WebAppProvider),
		svc("Accounts", AccountsProvider),
		svc("OIDC", OIDCProvider),
	],
	integrations: [
		svc("GameBridge", GameBridgeProvider),
		svc("Github", GithubProvider),
		svc("Gitlab", GitlabProvider),
		svc("Steam", SteamProvider),
		svc("Resonite", ResoniteProvider),
		svc("Addons", AddonsProvider),
		svc("DiscordBot", DiscordBotProvider),
		// Depend on DiscordBot
		svc("Fluxer", FluxerProvider),
		svc("Markov", MarkovProvider),
		svc("Motd", MotdProvider),
		svc("IRC", IRCProvider),
		svc("Starboard", StarboardProvider),
		svc("DiscordMetadata", DiscordMetadataProvider),
	],
} as const;

export type ServiceGroup = keyof typeof SERVICE_GROUPS;

const ALL: Entry[] = Object.values(SERVICE_GROUPS).flat() as unknown as Entry[];

/**
 * Picks providers from a comma separated list of group names and/or service
 * names ("infra,web,DiscordBot"), keeping canonical boot order. Undefined
 * means everything (production).
 */
export const selectServices = (spec: string | undefined): Provider[] => {
	if (!spec) return ALL.map(entry => entry.provider);
	const wanted = new Set<string>();
	for (const raw of spec.split(",")) {
		const part = raw.trim();
		if (!part || part === "none") continue;
		if (part in SERVICE_GROUPS) {
			for (const entry of SERVICE_GROUPS[part as ServiceGroup]) wanted.add(entry.name);
		} else {
			wanted.add(part);
		}
	}
	const unknown = [...wanted].filter(name => !ALL.some(entry => entry.name === name));
	if (unknown.length)
		throw new Error(`unknown services in METACONCORD_SERVICES: ${unknown.join(", ")}`);
	return ALL.filter(entry => wanted.has(entry.name)).map(entry => entry.provider);
};

export {
	Accounts,
	Addons,
	Bans,
	Data,
	DiscordBot,
	DiscordMetadata,
	Fluxer,
	GameBridge,
	Github,
	Gitlab,
	IRC,
	Markov,
	Motd,
	OIDC,
	Resonite,
	SQL,
	Steam,
	WebApp,
};

export type ServiceMap = {
	[key: string]: Service;
	Accounts: Accounts;
	Addons: Addons;
	Bans: Bans;
	Data: Data;
	DiscordBot: DiscordBot;
	DiscordMetadata: DiscordMetadata;
	Fluxer: Fluxer;
	GameBridge: GameBridge;
	Github: Github;
	Gitlab: Gitlab;
	IRC: IRC;
	Markov: Markov;
	Motd: Motd;
	OIDC: OIDC;
	Resonite: Resonite;
	SQL: SQL;
	Starboard: Starboard;
	Steam: Steam;
	WebApp: WebApp;
};
