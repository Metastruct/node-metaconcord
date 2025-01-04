import { App } from ".";
import { Service, ServiceMap } from "./services";

type ProviderFactory = { (container: Container): Service | Promise<Service> }[];

export class Container {
	readonly app: App;
	private providers: ProviderFactory;
	private services = {} as ServiceMap;
	private pendingServices = new Map<string, Promise<Service>>();

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

	async addService(service: Service | Promise<Service>): Promise<void> {
		if (service instanceof Promise) {
			service = await service;
		}
		this.services[service.name] = service;

		// Resolve any pending waiters
		const pendingPromise = this.pendingServices.get(service.name);
		if (pendingPromise) {
			this.pendingServices.delete(service.name);
		}
	}

	async getService<Name extends string>(
		type: Name,
		timeoutMs = 30000
	): Promise<ServiceMap[Name]> {
		if (this.services[type]) {
			return this.services[type];
		}

		// Create or return existing promise for this service
		if (!this.pendingServices.has(type)) {
			this.pendingServices.set(
				type,
				new Promise((resolve, reject) => {
					const timeoutId = setTimeout(() => {
						this.pendingServices.delete(type);
						reject(new Error(`Timeout waiting for service: ${type}`));
					}, timeoutMs);

					const checkInterval = setInterval(() => {
						if (this.services[type]) {
							clearTimeout(timeoutId);
							clearInterval(checkInterval);
							resolve(this.services[type]);
						}
					}, 100);
				})
			);
		}

		return this.pendingServices.get(type) as Promise<ServiceMap[Name]>;
	}
}
