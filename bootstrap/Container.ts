import providers from "./providers";

export interface IService {
	name: string;
}

type ProviderFactory = { (container: Container): IService }[];

export class Container {
	private providers: ProviderFactory;
	private services: IService[] = [];

	constructor(providers: ProviderFactory) {
		this.providers = providers;
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

	getService<T extends IService>(type: new (...args: any[]) => T): T {
		for (let i = 0; i < this.services.length; i++) {
			const service = this.services[i];
			if (service instanceof type) return service;
		}
	}
}

export const container = new Container(providers);
