import { App } from ".";
import { Service, ServiceMap } from "./services";

type ProviderFactory = { (container: Container): Service | Promise<Service> }[];

export class Container {
	readonly app: App;
	private providers: ProviderFactory;
	private services: ServiceMap = {};

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

	getService<Name extends string>(type: Name): ServiceMap[Name] {
		return this.services[type];
	}
}
