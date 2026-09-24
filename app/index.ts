import { Container } from "./Container.js";
import { selectServices } from "./services/index.js";

declare global {
	var MetaConcord: {
		container: Container;
	};
}

export class App {
	container: Container;

	constructor() {
		this.container = new Container(this, selectServices(process.env.METACONCORD_SERVICES));
	}

	async init(): Promise<void> {
		for (const provider of this.container.getProviders()) {
			this.container.addService(provider(this.container));
		}
		await this.container.initServices();
	}
}
