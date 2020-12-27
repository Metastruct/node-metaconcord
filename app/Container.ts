import { IService } from "./services";
import providers from "./services";

type ProviderFactory = { (container: Container): IService | Promise<IService> }[];

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

	async addService(service: IService | Promise<IService>): Promise<void> {
		if (service instanceof Promise) {
			service = await service;
		}
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
