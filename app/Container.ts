import { App } from "./index.js";
import { ServiceMap } from "./services/index.js";

type ProviderFactory = { (container: Container): Service }[];
export class Service {
	readonly name: string;
	container: Container;

	constructor(container: Container) {
		this.container = container;
	}

	async init(): Promise<void> {}
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

	async initServices(): Promise<void> {
		for (const service of Object.values(this.services)) {
			await service.init();
		}
	}

	getService<ServiceName extends string>(service: ServiceName): ServiceMap[ServiceName] {
		return this.services[service];
	}
}
