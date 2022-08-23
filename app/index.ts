import { Container } from "./Container";
import providers from "./services";

export class App {
	container: Container;

	constructor() {
		this.container = new Container(this, providers);

		this.init();
	}

	async init(): Promise<void> {
		for (const provider of this.container.getProviders()) {
			let providersToLoad;
			if (process.env.METACONCORD_LOAD_SERVICES) {
				const splitServices = process.env.METACONCORD_LOAD_SERVICES.split(" ");
				if (splitServices) {
					providersToLoad = Object.fromEntries(
						splitServices.filter(x => x).map(provider => [provider.toLowerCase(), true])
					);
				}
			}

			const providerName = provider.name.replace(/Provider$/, "").toLowerCase(); // Hack lol
			const load = providersToLoad ? providersToLoad[providerName] : true;
			if (load) {
				const service = await provider(this.container);
				this.container.addService(service);
			}
		}
	}
}
