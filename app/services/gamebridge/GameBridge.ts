import { Container, Service } from "@/app/Container.js";
import { WebApp } from "@/app/services/webapp/index.js";
import { WsRouter } from "./WsRouter.js";
import { attachGmod } from "./games/gmod/index.js";
import GmodConnection from "./games/gmod/GmodConnection.js";
import { attachMinecraft } from "./games/minecraft/index.js";
import MinecraftConnection from "./games/minecraft/MinecraftConnection.js";
import { attachResonite } from "./games/resonite/index.js";
import ResoniteConnection from "./games/resonite/ResoniteConnection.js";
import { attachSS13 } from "./games/ss13/index.js";
import SS13Connection from "./games/ss13/SS13Connection.js";
import { attachVRChat } from "./games/vrchat/index.js";
import VRChatConnection from "./games/vrchat/VRChatConnection.js";
import { EventEmitter } from "events";

export type GitHubPushPayload = {
	repo: string;
	branch: string;
	commits: { author: string; message: string; hash: string }[];
};

export type GitHubPullRequestPayload = {
	repo: string;
	action: "opened" | "reopened" | "closed" | "merged" | "ready_for_review";
	number: number;
	title: string;
	author: string;
	branch: string;
	baseBranch: string;
	url: string;
};

export interface GameBridgeEvents {
	githubPush: [payload: GitHubPushPayload];
	githubPullRequest: [payload: GitHubPullRequestPayload];
}

export default class GameBridge extends Service {
	name = "GameBridge";
	webApp: WebApp;
	/** Each game keeps its own id space, starting at 1 -- ids are only unique within a game. */
	servers: {
		gmod: GmodConnection[];
		minecraft: MinecraftConnection[];
		resonite: ResoniteConnection[];
		ss13: SS13Connection[];
		vrchat: VRChatConnection[];
	} = { gmod: [], minecraft: [], resonite: [], ss13: [], vrchat: [] };
	ready: boolean = false;
	events = new EventEmitter<GameBridgeEvents>();

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
