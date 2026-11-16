import { type Container } from "../Container.ts";
import { type Service } from "../Service.ts";

export type ServiceProvider = (container: Container) => Service;

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
