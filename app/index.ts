import { Container, container } from "./Container";

export class App {
	container: Container;

	constructor(container: Container) {
		this.container = container;

		this.init();
	}

	async init(): Promise<void> {
		for (const provider of this.container.getProviders()) {
			await this.container.addService(provider(this.container));
		}
	}
}

export default new App(container);
