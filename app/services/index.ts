import type { Service } from "../Service.ts";
import AccountsProvider, { type Accounts } from "./Accounts.ts";
import AddonsProvider, { type Addons } from "./addons/index.ts";
import BanProvider, { type Bans } from "./Bans.ts";
import DataProvider, { type Data } from "./Data.ts";
import DiscordBotProvider, { type DiscordBot } from "./discord/index.ts";
import DiscordMetadataProvider, { type DiscordMetadata } from "./DiscordMetadata.ts";
import FluxerProvider, { type Fluxer } from "./fluxer/index.ts";
import GameBridgeProvider, { type GameBridge } from "./gamebridge/index.ts";
import GithubProvider, { type Github } from "./Github.ts";
import GitlabProvider, { type Gitlab } from "./Gitlab.ts";
import MarkovProvider, { type Markov } from "./Markov.ts";
import MotdProvider, { type Motd } from "./Motd.ts";
import OIDCProvider, { type OIDC } from "./OIDC.ts";
import ResoniteProvider, { type Resonite } from "./Resonite.ts";
import LocalDBProvider, { type LocalDB } from "./sql/LocalDB.ts";
import RemoteDBProvider, { type RemoteDB } from "./sql/RemoteDB.ts";
import StarboardProvider, { type Starboard } from "./Starboard.ts";
import SteamProvider, { type Steam } from "./Steam.ts";
import type { ServiceName, ServiceProvider } from "./types.ts";
import WebAppProvider, { type WebApp } from "./webapp/index.ts";


/** A provider tagged with the service name it constructs (factories are anonymous). */
type Entry = { name: string; provider: ServiceProvider };
const svc = (name: string, provider: ServiceProvider): Entry => ({ name, provider });

/**
 * Service groups, ordered so every service comes after its hard requirements.
 * A run enables a subset of these (see selectServices) and production uses all.
 */
export const SERVICE_GROUPS = {
	infra: [
		svc("LocalDB", LocalDBProvider),
		svc("RemoteDB", RemoteDBProvider),
		svc("Data", DataProvider),
		svc("Bans", BanProvider),
	],
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
		svc("Starboard", StarboardProvider),
		svc("DiscordMetadata", DiscordMetadataProvider),
	],
} as const;

export type ServiceGroup = keyof typeof SERVICE_GROUPS;

const ALL: Entry[] = Object.values(SERVICE_GROUPS).flat();

/**
 * Picks providers from a comma separated list of group names and/or service
 * names ("infra,web,DiscordBot"), keeping canonical boot order. Undefined
 * means everything (production).
 */
export const selectServices = (spec: string | undefined): ServiceProvider[] => {
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
	const unknown = [...wanted].filter(name => ALL.every(entry => entry.name !== name));
	if (unknown.length > 0)
		throw new Error(`unknown services in METACONCORD_SERVICES: ${unknown.join(", ")}`);
	return ALL.filter(entry => wanted.has(entry.name)).map(entry => entry.provider);
};

type DefineServiceMap<T extends Record<ServiceName, Service>
	& Record<Exclude<keyof T, ServiceName>, never>> = T;

export type ServiceMap = DefineServiceMap<{
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
	Markov: Markov;
	Motd: Motd;
	OIDC: OIDC;
	Resonite: Resonite;
	LocalDB: LocalDB;
	RemoteDB: RemoteDB;
	Starboard: Starboard;
	Steam: Steam;
	WebApp: WebApp;
}>;

export { Accounts } from "./Accounts.ts";
export { Addons } from "./addons/index.ts";
export { Bans } from "./Bans.ts";
export { Data } from "./Data.ts";
export { DiscordBot } from "./discord/index.ts";
export { DiscordMetadata } from "./DiscordMetadata.ts";
export { Fluxer } from "./fluxer/index.ts";
export { GameBridge } from "./gamebridge/index.ts";
export { Github } from "./Github.ts";
export { Gitlab } from "./Gitlab.ts";
export { Markov } from "./Markov.ts";
export { Motd } from "./Motd.ts";
export { OIDC } from "./OIDC.ts";
export { Resonite } from "./Resonite.ts";
export { LocalDB } from "./sql/LocalDB.ts";
export { RemoteDB } from "./sql/RemoteDB.ts";
export { Steam } from "./Steam.ts";
export { WebApp } from "./webapp/index.ts";

