import { EventEmitter } from "node:events";

import { type Container, Service } from "#/app/Container.js";
import { type WebApp } from "#/app/services/webapp/index.js";
import type GmodConnection from "./games/gmod/GmodConnection.js";
import { attachGmod } from "./games/gmod/index.js";
import { attachMinecraft } from "./games/minecraft/index.js";
import type MinecraftConnection from "./games/minecraft/MinecraftConnection.js";
import { attachResonite } from "./games/resonite/index.js";
import type ResoniteConnection from "./games/resonite/ResoniteConnection.js";
import { attachSS13 } from "./games/ss13/index.js";
import type SS13Connection from "./games/ss13/SS13Connection.js";
import { attachVRChat } from "./games/vrchat/index.js";
import type VRChatConnection from "./games/vrchat/VRChatConnection.js";
import StatsHistory from "./StatsHistory.js";

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
	override name = "GameBridge";
	webApp!: WebApp;
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
	/**
	 * Stats ring buffers keyed by "<game>:<id>". Kept here rather than on the
	 * connection objects, which are recreated on every websocket reconnect.
	 */
	private stats = new Map<string, StatsHistory>();

	statsFor(game: keyof GameBridge["servers"], id: number): StatsHistory {
		const key = `${game}:${id}`;
		let history = this.stats.get(key);
		if (!history) {
			history = new StatsHistory();
			this.stats.set(key, history);
		}
		return history;
	}

	constructor(container: Container) {
		super(container);
	}

	override async init() {
		this.webApp = this.container.getService("WebApp");
		this.ready = true;
	}

	/** WebApp creates its ws router in start(), after all services init. */
	override async start() {
		const router = this.webApp.ws;
		attachGmod(this, router);
		attachResonite(this);
		attachSS13(this);
		attachMinecraft(this, router);
		attachVRChat(this);
	}
}
