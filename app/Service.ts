import { type Container } from "./Container.ts";

/** Thrown by getService for a service the current run doesn't include. */
export class ServiceNotEnabledError extends Error {
	constructor(serviceName: string) {
		super(`service ${serviceName} is not enabled on this instance`);
	}
}

export abstract class Service {
	abstract readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}

	async init(): Promise<void> {}

	/** Runs after every service has initialized; open sockets/ports here. */
	async start(): Promise<void> {}
}
