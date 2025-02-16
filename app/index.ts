import { Container } from "./Container";
import providers from "./services";

declare global {
	var MetaConcord: {
		container: Container;
	}
}

export class App {
	container: Container;

	constructor() {
		this.container = new Container(this, providers);

		this.init();
	}

	async init(): Promise<void> {
		for (const provider of this.container.getProviders()) {
			await this.container.addService(provider(this.container));
		}
	}
}
