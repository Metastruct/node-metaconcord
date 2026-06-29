import { Container } from "./Container.js";
import providers from "./services/index.js";

declare global {
	var MetaConcord: {
		container: Container;
	};
}

export class App {
	container: Container;

	constructor() {
		this.container = new Container(this, providers);
	}

	async init(): Promise<void> {
		for (const provider of this.container.getProviders()) {
			this.container.addService(provider(this.container));
		}
		await this.container.initServices();
	}
}
