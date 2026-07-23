import * as Discord from "discord.js";
import { Container, Service } from "@/app/Container.js";
import { WebApp } from "@/app/services/webapp/index.js";
import GameConnection from "./GameConnection.js";
import { attachGmod } from "./games/gmod/index.js";
import { attachResonite } from "./games/resonite/index.js";
import { attachSS13 } from "./games/ss13/index.js";
import config from "@/config/gamebridge.json" with { type: "json" };
import servers from "@/config/gamebridge.servers.json" with { type: "json" };

export default class GameBridge extends Service {
	name = "GameBridge";
	config = {
		servers,
		...config,
	};
	webApp: WebApp;
	servers: GameConnection[] = [];
	discordChatWH = new Discord.WebhookClient({
		url: config.chatWebhookUrl,
	});
	discordErrorWH = new Discord.WebhookClient({
		url: config.errorWebhookUrl,
	});
	discordPacErrorWH = new Discord.WebhookClient({
		url: config.pacErrorWebhookUrl,
	});
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
