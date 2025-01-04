import { Container } from "./Container";
import providers from "./services";

export class App {
	container: Container;

	constructor() {
		this.container = new Container(this, providers);
	}
}
