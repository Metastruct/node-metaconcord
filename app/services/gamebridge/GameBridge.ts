import { Container, Service } from "@/app/Container.js";
import { WebApp } from "@/app/services/webapp/index.js";
import GameConnection from "./GameConnection.js";
import { attachGmod } from "./games/gmod/index.js";
import { attachResonite } from "./games/resonite/index.js";
import { attachSS13 } from "./games/ss13/index.js";

export default class GameBridge extends Service {
	name = "GameBridge";
	webApp: WebApp;
	servers: GameConnection[] = [];
	ready: boolean = false;

	constructor(container: Container) {
		super(container);
	}

	async init() {
		this.webApp = this.container.getService("WebApp");

		attachGmod(this);
		attachResonite(this);
		attachSS13(this);

		this.ready = true;
	}
}
