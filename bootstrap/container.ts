import makeBot from "./providers/bot";
import makeTest from "./providers/test";

export interface IService {
	name: string;
}

type ProviderFactory = { (container: Container): IService }[];

export class Container {
	private providers: ProviderFactory;
	private services: IService[] = [];

	constructor(providers: ProviderFactory) {
		this.providers = providers;

		for (const provider of this.getProviders()) {
			this.addService(provider(this));
		}
	}

	getProviders(): ProviderFactory {
		return this.providers;
	}

	getServices(): IService[] {
		return this.services;
	}

	addService(service: IService): void {
		this.services.push(service);
	}

	getService<T extends IService>(type: new () => T): T {
		for (let i = 0; i < this.services.length; i++) {
			const service = this.services[i];
			if (service instanceof type) return service;
		}
	}
}

export const container = new Container([makeBot, makeTest]);
