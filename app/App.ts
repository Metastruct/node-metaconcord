import { Container } from "./Container.ts";
import { selectServices } from "./services/index.ts";

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
