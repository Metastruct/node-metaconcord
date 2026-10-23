import { DiscordBot } from "../index.js";
import { hash } from "node:crypto";
import { ok as assert } from "node:assert";
import { Shat } from "./shitposting.js";

const MESSAGE_COMBO_BREAKER = "C-C-C-COMBO BREAKER!!";
const REACTION_DOUBLE_POSTER = "🤔";

const THRESHOLD_COMBO = 3;
const THRESHOLD_REACT_TO_DOUBLE_POST = 3;
const THRESHOLD_BREAK_THE_COMBO = 4;

assert(THRESHOLD_REACT_TO_DOUBLE_POST >= THRESHOLD_COMBO);
assert(THRESHOLD_BREAK_THE_COMBO >= THRESHOLD_COMBO);

enum ComboMessageEffect {
	/** Nothing happened (no active combo). */
	NONE,
	/** Combo upheld and increased in power level. */
	INCREMENTED,
	/** Combo upheld, but this was a double-post by a previous participant. */
	DOUBLE_POSTED,
	/** Combo was broken by this message. */
	BROKEN
}

class Combo {
	readonly #channelId: string;
	#messageHash: string;

	#participants = new Set<string>();
	#doublePosters = new Set<string>();

	constructor(channelId: string) {
		this.#channelId = channelId;
	}

	private computeMessageHash(message: string): string {
		return hash("md5", message);
	}

	private reset() {
		this.#participants.clear();
		this.#doublePosters.clear();
	}

	private isActive() {
		return this.length >= THRESHOLD_COMBO;
	}

	/**
	 * Updates the combo state with the given message.
	 * @param userId The ID of the message's author.
	 * @param message The message contents.
	 * @returns What this message did to the combo.
	 */
	public onMessage(userId: string, message: string): ComboMessageEffect {
		const wasActive = this.isActive();
		const newHash = this.computeMessageHash(message);

		if (newHash !== this.#messageHash) {
			this.reset();
			this.#messageHash = newHash;
			this.#participants.add(userId);
			return wasActive ? ComboMessageEffect.BROKEN : ComboMessageEffect.NONE;
		}

		if (this.#participants.has(userId)) {
			this.#doublePosters.add(userId);
			return wasActive ? ComboMessageEffect.DOUBLE_POSTED : ComboMessageEffect.NONE;
		} else {
			this.#participants.add(userId);
			return wasActive ? ComboMessageEffect.INCREMENTED : ComboMessageEffect.NONE;
		}
	}

	public break() {
		this.reset();
		this.#messageHash = "";
	}
	
	public get channelId() {
		return this.#channelId;
	}
	
	public get length() {
		return this.#participants.size;
	}

	public toString() {
		const view = {
			channelId: this.#channelId,
			messageHash: this.#messageHash,
			isActive: this.isActive(),
			participants: Array.from(this.#participants),
			doublePosters: Array.from(this.#doublePosters)
		};
		return `Combo${JSON.stringify(view)}`;
	}
}

class ComboManager {
	#combos = new Map<string, Combo>();

	/**
	 * Updates the channel's combo state with the given message.
	 * @param channelId The ID of the channel.
	 * @param userId The ID of the message's author.
	 * @param message The message contents.
	 * @returns The combo and what this message did to the combo.
	 */
	public onMessage(channelId: string, userId: string, message: string): {combo: Combo, effect: ComboMessageEffect} {
		const combo = this.#combos.getOrInsert(channelId, new Combo(channelId));
		return { combo, effect: combo.onMessage(userId, message) };
	}

	public toString() {
		const view = {
			combos: this.#combos.values().map(combo => combo.toString()).toArray()
		};
		return `ComboManager${JSON.stringify(view)}`;
	}
}

export default (bot: DiscordBot): void => {
	const comboManager = new ComboManager();

	bot.discord.on("messageCreate", async msg => {
		if (msg.author.id === bot.discord.user.id)
			return;

		const {combo, effect} = comboManager.onMessage(msg.channelId, msg.author.id, msg.content);

		//msg.channel.send(combo.toString());

		switch (effect) {
			case ComboMessageEffect.INCREMENTED:
				if (combo.length >= THRESHOLD_BREAK_THE_COMBO) {
					combo.break();
					const shitpost = await Shat({msg: msg.content});
					msg.channel.send(shitpost);
				}
				break;
			case ComboMessageEffect.DOUBLE_POSTED:
				if (combo.length >= THRESHOLD_REACT_TO_DOUBLE_POST)
					msg.react(REACTION_DOUBLE_POSTER);
				break;
			case ComboMessageEffect.BROKEN:
				msg.channel.send(MESSAGE_COMBO_BREAKER);
				break;
			case ComboMessageEffect.NONE:
				// Do Nothing.
		}
	});
};
