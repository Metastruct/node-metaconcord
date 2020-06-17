import { container, Container } from "@/bootstrap/container";

export class App {
	public container: Container;

	constructor(container: Container) {
		this.container = container;
	}
}

const app = new App(container);

export default app;
