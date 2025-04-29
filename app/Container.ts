import { App } from "./index.js";
import { ServiceMap } from "./services/index.js";

type ProviderFactory = { (container: Container): Service | Promise<Service> }[];
export class Service {
	readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}
}

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

	async getService<ServiceName extends string>(
		service: ServiceName,
		timeoutMs = 30000
	): Promise<ServiceMap[ServiceName]> {
		if (this.services[service]) {
			return this.services[service];
		}

		// Create or return existing promise for this service
		if (!this.pendingServices.has(service)) {
			this.pendingServices.set(
				service,
				new Promise((resolve, reject) => {
					const timeoutId = setTimeout(() => {
						this.pendingServices.delete(service);
						reject(new Error(`Timeout waiting for service: ${service}`));
					}, timeoutMs);

					const checkInterval = setInterval(() => {
						if (this.services[service]) {
							clearTimeout(timeoutId);
							clearInterval(checkInterval);
							resolve(this.services[service]);
						}
					}, 100);
				})
			);
		}

		return this.pendingServices.get(service) as Promise<ServiceMap[ServiceName]>;
	}
}
