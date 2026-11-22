import type { ValueOf } from "#utils";
import type { Container } from "../Container.ts";
import type { ServiceMap } from "./index.ts";

export type ServiceProvider = (container: Container) => ValueOf<ServiceMap>;

export const ServiceNames = [
	"Accounts",
	"Addons",
	"Bans",
	"Data",
	"DiscordBot",
	"DiscordMetadata",
	"Fluxer",
	"GameBridge",
	"Github",
	"Gitlab",
	"Markov",
	"Motd",
	"OIDC",
	"Resonite",
	"LocalDB",
	"RemoteDB",
	"Starboard",
	"Steam",
	"WebApp",
] as const;

export type ServiceName = typeof ServiceNames[number];
