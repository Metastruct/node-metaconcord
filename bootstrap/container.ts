import makeBot from "./providers/bot";

export interface Service {
	name: string;
}

type ProviderFactory = { (container: Container): Service }[];

export class Container {
	private providers: ProviderFactory;
	private services: Service[] = [];

	constructor(providers: ProviderFactory) {
		this.providers = providers;

		for (const provider of this.getProviders()) {
			this.addService(provider(this));
		}
	}

	getProviders(): ProviderFactory {
		return this.providers;
	}

	getServices(): Service[] {
		return this.services;
	}

	addService(service: Service): void {
		this.services.push(service);
	}

	getService<T extends Service>(name?: string): T {
		for (let i = 0; i < this.services.length; i++) {
			const service = this.services[i];
			if ((service as T) && (!name || service.name == name))
				return this.services[i] as T;
		}
	}
}

export const container = new Container([makeBot]);
