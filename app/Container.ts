import { App } from ".";
import { Service, ServiceMap } from "./services";

type ProviderFactory = { (container: Container): Service | Promise<Service> }[];

export class Container {
	readonly app: App;
	private providers: ProviderFactory;
	private services = {} as ServiceMap;
	private initPromises = new Map<string, Promise<Service>>();

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
	}

	async getService<T extends keyof ServiceMap>(name: T): Promise<ServiceMap[T]> {
		const service = this.services[name];
		if (service) {
			return service as ServiceMap[T];
		}

		// If already initializing, wait for it
		if (this.initPromises.has(String(name))) {
			return this.initPromises.get(String(name)) as Promise<ServiceMap[T]>;
		}

		// Find the provider
		const provider = this.providers.find(p => {
			const temp = p(this);
			if (temp instanceof Promise) {
				return temp.then(s => s.name === name);
			}
			return temp.name === name;
		});

		if (!provider) {
			throw new Error(`Service ${String(name)} not found`);
		}

		// Initialize the service
		const promise = Promise.resolve(provider(this)).then(service => {
			this.services[name] = service;
			this.initPromises.delete(String(name));
			return service as ServiceMap[T];
		});

		this.initPromises.set(String(name), promise);
		return promise;
	}
}
