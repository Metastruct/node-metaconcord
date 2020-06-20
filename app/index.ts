import { Container, container } from "@/bootstrap/container";

export class App {
	public container: Container;

	constructor(container: Container) {
		this.container = container;

		for (const provider of this.container.getProviders()) {
			this.container.addService(provider(this.container));
		}
	}
}

const app = new App(container);

export default app;
