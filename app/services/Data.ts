import { existsSync, mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import path from "node:path";

import { logger } from "#lib/logger";
import { errToMessage } from "#utils";
import type { Container } from "../Container.ts";
import { Service } from "../Service.ts";
import type { AddonsStore } from "./addons/types.ts";
import type { Rule } from "./discord/index.ts";

const log = logger(import.meta);
const dataPath = path.join(process.cwd(), "data");
const toFilePath = (fieldName: string) => path.join(dataPath, `${fieldName}.json`);

export class Data extends Service {
	override readonly name = "Data";

	#initialized = false;
	#persistenceSuppressed = false;

	#noPersistence(): Disposable {
		if (this.#persistenceSuppressed) throw new Error("Persistence is already suppressed.");
		this.#persistenceSuppressed = true;
		return { [Symbol.dispose]: () => { this.#persistenceSuppressed = false; } };
	}

	#lastDiscordGuildEvent: string | undefined;
	#lastDiscordNickName: string | undefined;
	#lastMsgTime: number | undefined;
	#lastResoniteToken: string | undefined;
	#lastResoniteTokenTime: number | undefined;

	/* eslint-disable stylistic/space-before-function-paren */
	get lastDiscordGuildEvent() { return this.#lastDiscordGuildEvent; }
	get lastDiscordNickName  () { return this.#lastDiscordNickName  ; }
	get lastMsgTime          () { return this.#lastMsgTime          ; }
	get lastResoniteToken    () { return this.#lastResoniteToken    ; }
	get lastResoniteTokenTime() { return this.#lastResoniteTokenTime; }

	set lastDiscordGuildEvent(v) { this.#lastDiscordGuildEvent = v; this.#saveField("lastDiscordGuildEvent", v); }
	set lastDiscordNickName  (v) { this.#lastDiscordNickName   = v; this.#saveField("lastDiscordNickName"  , v); }
	set lastMsgTime          (v) { this.#lastMsgTime           = v; this.#saveField("lastMsgTime"          , v); }
	set lastResoniteToken    (v) { this.#lastResoniteToken     = v; this.#saveField("lastResoniteToken"    , v); }
	set lastResoniteTokenTime(v) { this.#lastResoniteTokenTime = v; this.#saveField("lastResoniteTokenTime", v); }
	/* eslint-enable stylistic/space-before-function-paren */


	addons: AddonsStore = {};
	permaRoles: {
		[userId: string]: {
			roles: { [roleId: string]: { adderId: string; timeStamp: number } };
		};
	} = {};
	rules: Array<Rule> = [];
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

	// Automatically persisted
	readonly #primitiveFields = [
		"lastDiscordGuildEvent",
		"lastDiscordNickName",
		"lastMsgTime",
		"lastResoniteToken",
		"lastResoniteTokenTime",
	] as const satisfies Array<keyof this>;

	// Require calling save()
	readonly #objectFields = [
		"addons",
		"permaRoles",
		"reportThreads",
		"rules",
		"tempVoiceChannels",
	] as const satisfies Array<keyof this>;

	// Used to exist but not anymore
	readonly #deleted = [
		"lastDiscordBanner",
		"lastDiscordGuildIcon",
		"lastMotd",
		"muted",
	];

	override async init(): Promise<void> {
		if (this.#initialized)
			throw new Error("Already initialized. Calling init() again could overwrite in-memory data not yet persisted to storage.");

		if (existsSync(dataPath)) {
			if (!statSync(dataPath).isDirectory())
				throw new Error(`Data path issue: ${dataPath} exists but is not a directory.`);
		} else {
			mkdirSync(dataPath);
		}

		this.#migrate();
		this.#load();
		this.#initialized = true;
	}

	#migrate() {
		for (const moduleName of this.#deleted) {
			const filePath = path.join(dataPath, moduleName + ".json");
			if (existsSync(filePath))
				unlinkSync(filePath);
		}
	}

	#load() {
		using _ = this.#noPersistence();

		for (const fieldName of Iterator.concat<string & keyof this>(this.#primitiveFields, this.#objectFields)) {
			const filePath = toFilePath(fieldName);
			try {
				this[fieldName] = JSON.parse(readFileSync(filePath, "utf8"));
				log.info(`loaded ${filePath}`);
			} catch (error) {
				log.error(`failed to load ${filePath}: ${errToMessage(error)}`);
			}
		}
	}

	#isPrimitiveField(fieldName: string) { return (this.#primitiveFields as readonly string[]).includes(fieldName); }
	#isObjectField(fieldName: string) { return (this.#objectFields as readonly string[]).includes(fieldName); }

	#saveField(fieldName: string, value: unknown): void {
		if (!this.#isObjectField(fieldName) && !this.#isPrimitiveField(fieldName))
			throw new RangeError(`Invalid fieldName '${fieldName}'.`);

		if (this.#persistenceSuppressed)
			return;

		if (!this.#initialized)
			throw new Error("Tried to save before initializing. Call init() first.");

		if (value === undefined)
			unlinkSync(toFilePath(fieldName));
		else
			writeFileSync(toFilePath(fieldName), JSON.stringify(value) ?? "");
	}

	/**
	 * Persist all fields.
	 * @deprecated Prefer `save(field1, field2, ...)` to only persist what has changed.
	 */
	save(): void;

	/**
	 * Persist one or multiple field(s).
	 * @param fieldNames The field(s) to persist.
	 */
	save<T extends (string & keyof this)>(...fieldNames: [T, ...T[]]): void;

	save<T extends (string & keyof this)>(...fieldNames: T[]): void {
		const fields: ReadonlyArray<string & keyof this> =
			fieldNames.length === 0
				? this.#objectFields // No arguments => deprecated behavior: save all.
				: fieldNames; // >= 1 arguments: save requested fields.

		for (const fieldName of new Set(fields))
			this.#saveField(fieldName, this[fieldName]);
	}
}

export default function DataProvider(container: Container) {
	return new Data(container);
}
