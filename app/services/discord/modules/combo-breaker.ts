import { ok as assert } from "node:assert";
import { hash } from "node:crypto";
import { type Message } from "discord.js";

import { type DiscordBot } from "../index.js";
import { Shat } from "./shitposting.js";

const MESSAGE_COMBO_BREAKER = "C-C-C-COMBO BREAKER!!";
const REACTIONS_DOUBLE_POSTER = ["👎","🤔","🤨","😑","😔","😠","🙄"] as const;

const THRESHOLD_COMBO = 3;
const THRESHOLD_REACT_TO_DOUBLE_POST = 3;
const THRESHOLD_BREAK_THE_COMBO = 4;

assert(THRESHOLD_REACT_TO_DOUBLE_POST >= THRESHOLD_COMBO);
assert(THRESHOLD_BREAK_THE_COMBO >= THRESHOLD_COMBO);

function randomDoublePostReaction() {
	return REACTIONS_DOUBLE_POSTER[Math.trunc(Math.random() * REACTIONS_DOUBLE_POSTER.length)];
}

enum ComboMessageEffect {
	/** Nothing happened (no active combo). */
	NONE,
	/** Combo upheld and increased in power level. */
	INCREMENTED,
	/** Combo upheld, but this was a double-post by a previous participant. */
	DOUBLE_POSTED,
	/** Combo was broken by this message. */
	BROKEN,
}

class Combo {
	readonly #channelId: string;
	#messageHash: string;

	#participants = new Set<string>();
	#doublePosters = new Set<string>();

	constructor(channelId: string) {
		this.#channelId = channelId;
	}

	static #computeMessageHash(message: Message): string {
		return hash("md5", JSON.stringify([
			message.content,
			message.attachments.map(attachment => [
				attachment.name,
				attachment.size,
				attachment.width,
				attachment.height,
				attachment.duration,
			]),
			message.embeds.map(embed => [
				embed.title,
				embed.description,
				embed.footer.text,
			]),
			message.stickers.map(sticker => sticker.id),
		]));
	}

	#reset() {
		this.#participants.clear();
		this.#doublePosters.clear();
	}

	#isActive() {
		return this.length >= THRESHOLD_COMBO;
	}

	/**
	 * Updates the combo state with the given message.
	 * @param message The message.
	 * @returns What this message did to the combo.
	 */
	public onMessage(message: Message): ComboMessageEffect {
		const authorId = message.author.id;
		const wasActive = this.#isActive();
		const newHash = Combo.#computeMessageHash(message);

		if (newHash !== this.#messageHash) {
			this.#reset();
			this.#messageHash = newHash;
			this.#participants.add(authorId);
			return wasActive ? ComboMessageEffect.BROKEN : ComboMessageEffect.NONE;
		}

		if (this.#participants.has(authorId)) {
			this.#doublePosters.add(authorId);
			return wasActive ? ComboMessageEffect.DOUBLE_POSTED : ComboMessageEffect.NONE;
		}

		this.#participants.add(authorId);
		return wasActive ? ComboMessageEffect.INCREMENTED : ComboMessageEffect.NONE;
	}

	public break() {
		this.#reset();
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
			isActive: this.#isActive(),
			participants: Array.from(this.#participants),
			doublePosters: Array.from(this.#doublePosters),
		};
		return `Combo${JSON.stringify(view)}`;
	}
}

class ComboManager {
	#combos = new Map<string, Combo>();

	/**
	 * Updates the channel's combo state with the given message.
	 * @param message The message.
	 * @returns The combo and what this message did to the combo.
	 */
	public onMessage(message: Message): {combo: Combo, effect: ComboMessageEffect} {
		const channelId = message.channelId;
		const combo = this.#combos.getOrInsertComputed(channelId, () => new Combo(channelId));
		return { combo, effect: combo.onMessage(message) };
	}

	public toString() {
		const view = {
			combos: this.#combos.values().map(combo => combo.toString()).toArray(),
		};
		return `ComboManager${JSON.stringify(view)}`;
	}
}

export default function ComboBreakerLoader(bot: DiscordBot): void {
	const comboManager = new ComboManager();

	bot.discord.on("messageCreate", async msg => {
		if (msg.author.id === bot.discord.user.id)
			return;

		const {combo, effect} = comboManager.onMessage(msg);

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
					msg.react(randomDoublePostReaction());
				break;
			case ComboMessageEffect.BROKEN:
				msg.reply(MESSAGE_COMBO_BREAKER);
				break;
			case ComboMessageEffect.NONE:
				// Do Nothing.
		}
	});
}
