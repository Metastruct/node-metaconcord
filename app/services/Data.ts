import { mkdirSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { logger } from "#utils";
import { type Container, Service } from "../Container.js";
import { type AddonsStore } from "./addons/types.js";
import { type Rule } from "./discord/index.js";

const log = logger(import.meta);

export class Data extends Service {
	override name = "Data";
	private dataPath = path.join(process.cwd(), "data");

	addons: AddonsStore = {};
	lastDiscordGuildEvent!: string;
	lastDiscordNickName!: string;
	lastMsgTime!: number;
	lastResoniteToken!: string;
	lastResoniteTokenTime!: number;
	permaRoles: {
		[userId: string]: {
			roles: { [roleId: string]: { adderId: string; timeStamp: number } };
		};
	} = {};
	rules!: Array<Rule>;
	tempVoiceChannels: {
		[ownerId: string]: {
			channelId: string;
			createdAt: number;
		};
	} = {};
	reportThreads: {
		[steamId64: string]: Array<{
			channelId: string;
			reportedSteamId64: string;
			pendingMessages: Array<{ username: string; content: string }>;
		}>;
	} = {};

	#toSave = [
		"addons",
		"lastDiscordGuildEvent",
		"lastDiscordNickName",
		"lastResoniteToken",
		"lastResoniteTokenTime",
		"lastMsgTime",
		"permaRoles",
		"reportThreads",
		"rules",
		"tempVoiceChannels",
	];

	#deleted = [
		"muted",
		"lastMotd",
		"lastDiscordBanner",
		"lastDiscordGuildIcon",
	];

	override async init(): Promise<void> {
		try {
			if (!statSync(this.dataPath).isDirectory()) {
				unlinkSync(this.dataPath);
				throw new Error("Data path was not a directory");
			}
		} catch {
			mkdirSync(this.dataPath);
		}
		this.#migrate();
		this.#load();
	}

	#migrate() {
		for (const moduleName of this.#deleted) {
			const filePath = path.join(this.dataPath, moduleName + ".json");
			if (statSync(filePath).isFile())
				unlinkSync(filePath);
		}
	}

	#load() {
		for (const file of readdirSync(this.dataPath)) {
			const filePath = path.join(this.dataPath, file);
			if (statSync(filePath).isFile() && path.extname(filePath) === ".json") {
				let data: unknown;
				try {
					data = JSON.parse(readFileSync(filePath, "utf8"));
				} catch {
					data = {};
				}
				log.info(`loaded ${file}`);
				this[path.basename(filePath, ".json")] = data;
			}
		}
	}

	save() {
		for (const moduleName of this.#toSave) {
			const data = this[moduleName];
			// if (typeof data !== "object") continue;
			const filePath = path.join(this.dataPath, moduleName + ".json");
			// console.log(`Saved ${filePath} with`, data);
			writeFileSync(filePath, JSON.stringify(data ?? {}));
		}
	}
}

export default function DataProvider(container: Container): Service {
	return new Data(container);
}
