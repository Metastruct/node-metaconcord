import { type Container, type Service } from "../Container.js";
import AccountsProvider, { type Accounts } from "./Accounts.js";
import AddonsProvider, { type Addons } from "./addons/index.js";
import BanProvider, { type Bans } from "./Bans.js";
import DataProvider, { type Data } from "./Data.js";
import DiscordBotProvider, { type DiscordBot } from "./discord/index.js";
import DiscordMetadataProvider, { type DiscordMetadata } from "./DiscordMetadata.js";
import FluxerProvider, { type Fluxer } from "./fluxer/index.js";
import GameBridgeProvider, { type GameBridge } from "./gamebridge/index.js";
import GithubProvider, { type Github } from "./Github.js";
import GitlabProvider, { type Gitlab } from "./Gitlab.js";
import IRCProvider, { type IRC } from "./IRC.js";
import MarkovProvider, { type Markov } from "./Markov.js";
import MotdProvider, { type Motd } from "./Motd.js";
import OIDCProvider, { type OIDC } from "./OIDC.js";
import ResoniteProvider, { type Resonite } from "./Resonite.js";
import LocalDBProvider, { type LocalDB } from "./sql/LocalDB.js";
import RemoteDBProvider, { type RemoteDB } from "./sql/RemoteDB.js";
import StarboardProvider, { type Starboard } from "./Starboard.js";
import SteamProvider, { type Steam } from "./Steam.js";
import WebAppProvider, { type WebApp } from "./webapp/index.js";

type Provider = (container: Container) => Service;
/** A provider tagged with the service name it constructs (factories are anonymous). */
type Entry = { name: string; provider: Provider };
const svc = (name: string, provider: Provider): Entry => ({ name, provider });

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
	const unknown = [...wanted].filter(name => ALL.every(entry => entry.name !== name));
	if (unknown.length > 0)
		throw new Error(`unknown services in METACONCORD_SERVICES: ${unknown.join(", ")}`);
	return ALL.filter(entry => wanted.has(entry.name)).map(entry => entry.provider);
};


export type ServiceMap = {
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
	LocalDB: LocalDB;
	RemoteDB: RemoteDB;
	Starboard: Starboard;
	Steam: Steam;
	WebApp: WebApp;
};

export type ServiceName = keyof ServiceMap;

export {Accounts} from "./Accounts.js";
export {Addons} from "./addons/index.js";
export {Bans} from "./Bans.js";
export {Data} from "./Data.js";
export {DiscordBot} from "./discord/index.js";
export {DiscordMetadata} from "./DiscordMetadata.js";
export {Fluxer} from "./fluxer/index.js";
export {GameBridge} from "./gamebridge/index.js";
export {Github} from "./Github.js";
export {Gitlab} from "./Gitlab.js";
export {IRC} from "./IRC.js";
export {Markov} from "./Markov.js";
export {Motd} from "./Motd.js";
export {OIDC} from "./OIDC.js";
export {Resonite} from "./Resonite.js";
export {LocalDB} from "./sql/LocalDB.js";
export {RemoteDB} from "./sql/RemoteDB.js";
export {Steam} from "./Steam.js";
export {WebApp} from "./webapp/index.js";
