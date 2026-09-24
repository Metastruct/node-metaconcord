import type { NextFunction, Request, Response } from "express";
import { App } from "./index.js";
import { ServiceMap } from "./services/index.js";

type ProviderFactory = { (container: Container): Service }[];

/**
 * What each service needs from the others, in two tiers:
 *
 * - hard: init()/the constructor touches it, so the boot fails with a clear
 *   error if it is missing. Add the missing service to METACONCORD_SERVICES
 *   or drop the dependent one.
 * - soft: only needed while handling messages/requests, so the dependent
 *   service still runs without it; the features using it degrade (503 or
 *   no-op). Services must read these with container.tryService().
 */
export type Requirements = { hard?: string[]; soft?: string[] };

export const REQUIREMENTS: Record<string, Requirements> = {
	Accounts: { hard: ["SQL"], soft: ["Github"] },
	Addons: { hard: ["Data"] },
	DiscordBot: {
		hard: ["Data"],
		soft: ["GameBridge", "Motd", "Markov", "Github", "Gitlab", "Fluxer", "Bans", "Steam"],
	},
	DiscordMetadata: { hard: ["SQL", "DiscordBot", "Bans", "Accounts"] },
	Fluxer: { hard: ["SQL", "DiscordBot"] },
	GameBridge: { hard: ["WebApp"] },
	IRC: { hard: ["DiscordBot"] },
	Motd: { hard: ["DiscordBot"], soft: ["Data"] },
	OIDC: { hard: ["WebApp", "SQL", "Accounts"] },
	Resonite: { hard: ["Data"] },
	Starboard: { hard: ["SQL", "DiscordBot"] },
	WebApp: { soft: ["SQL", "Accounts"] },
};

/** Thrown by getService for a service the current run doesn't include. */
export class ServiceNotEnabledError extends Error {
	constructor(public readonly service: string) {
		super(`service ${service} is not enabled on this instance`);
	}
}

export class Service {
	readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}

	async init(): Promise<void> {}

	/** Runs after every service has initialized; open sockets/ports here. */
	async start(): Promise<void> {}
}

export class Container {
	readonly app: App;
	private providers: ProviderFactory;
	private services = {} as ServiceMap;

	constructor(app: App, providers: ProviderFactory) {
		this.app = app;
		this.providers = providers;
	}

	getProviders(): ProviderFactory {
		return this.providers;
	}

	getServices(): ServiceMap {
		return this.services;
	}

	addService(service: Service): void {
		this.services[service.name] = service;
	}

	validateRequirements(): void {
		const enabled = new Set(Object.keys(this.services));
		for (const name of enabled) {
			for (const requirement of REQUIREMENTS[name]?.hard ?? []) {
				if (!enabled.has(requirement)) {
					throw new Error(
						`service ${name} requires ${requirement}, which is not enabled — add it to METACONCORD_SERVICES or drop ${name}`
					);
				}
			}
		}
		for (const name of enabled) {
			for (const requirement of REQUIREMENTS[name]?.soft ?? []) {
				if (!enabled.has(requirement)) {
					console.warn(
						`[container] ${name} running without ${requirement}: related features are disabled`
					);
				}
			}
		}
	}

	async initServices(): Promise<void> {
		this.validateRequirements();
		for (const service of Object.values(this.services)) {
			await service.init();
		}
		for (const service of Object.values(this.services)) {
			await service.start();
		}
	}

	/** Throws when the service isn't part of this run; use tryService to check. */
	getService<ServiceName extends string>(service: ServiceName): ServiceMap[ServiceName] {
		const found = this.services[service];
		if (!found) throw new ServiceNotEnabledError(service);
		return found;
	}

	/** Like getService, but undefined when the service isn't enabled. */
	tryService<ServiceName extends string>(
		service: ServiceName
	): ServiceMap[ServiceName] | undefined {
		return this.services[service];
	}

	/** True when the service is enabled (not necessarily ready). */
	has(name: string): boolean {
		return this.services[name] != null;
	}

	/** Express middleware: 503 unless every named service is enabled. */
	requireServices(...names: string[]) {
		return (req: Request, res: Response, next: NextFunction): void => {
			const missing = names.filter(name => !this.has(name));
			if (missing.length) {
				res.status(503).json({
					error: `${missing.join(", ")} not enabled on this instance`,
				});
				return;
			}
			next();
		};
	}
}
