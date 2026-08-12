import { Container, Service } from "@/app/Container.js";
import { WebApp } from "@/app/services/webapp/index.js";
import GameConnection from "./GameConnection.js";
import { WsRouter } from "./WsRouter.js";
import { attachGmod } from "./games/gmod/index.js";
import { attachMinecraft } from "./games/minecraft/index.js";
import { attachResonite } from "./games/resonite/index.js";
import { attachSS13 } from "./games/ss13/index.js";
import { attachVRChat } from "./games/vrchat/index.js";

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

		const router = new WsRouter(this.webApp.http);
		attachGmod(this, router);
		attachResonite(this);
		attachSS13(this);
		attachMinecraft(this, router);
		attachVRChat(this);

		this.ready = true;
	}
}
