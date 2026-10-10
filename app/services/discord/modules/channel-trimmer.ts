import { TextChannel, Message } from "discord.js";
import { DiscordBot } from "../index.js";
import { MinHeap } from "mnemonist";

// Hack: Node typings don't include this yet, but Node actually supports it.
declare global {
	interface Date {
	/**
	 * The toTemporalInstant() method of Date instances returns a new Temporal.Instant object
	 * with the same epochMilliseconds value as this date's timestamp.
	 */
		toTemporalInstant(): Temporal.Instant;
	}
}

type Timestamp = Date | Temporal.Instant;
type MessageFetchResult = Awaited<ReturnType<TextChannel["messages"]["fetch"]>>;

const Instant = (timestamp: Timestamp) => timestamp instanceof Date ? timestamp.toTemporalInstant() : timestamp;

const now = () => Temporal.Now.instant();
const durationSince = (time: Timestamp) => now().since(Instant(time)).round({ largestUnit: "year", relativeTo: Temporal.Now.plainDateISO() });
const olderThan = (instant: Timestamp, duration: Temporal.Duration) =>
	Temporal.Duration.compare(durationSince(instant), duration, { relativeTo: Temporal.Now.plainDateISO() }) > 0;

const durationFormatter = new Intl.DurationFormat("en", { style: "digital" });

const messageDateComparator = (a: Message, b: Message) => a.createdAt.getTime() - b.createdAt.getTime();


class ChannelTrimmingState {
	#maxAge: Temporal.Duration;
	#cache: MinHeap<Message>;

	constructor(duration: Temporal.Duration) {
		this.#maxAge = duration;
		this.#cache = new MinHeap<Message>(messageDateComparator);
	}
	
	public get maxAge() {
		return this.#maxAge;
	}
	
	public popOldMessage() {
		const top = this.#cache.peek();
		if (top && olderThan(top.createdAt, this.#maxAge))
			return this.#cache.pop();
	}

	public peekMessage() {
		return this.#cache.peek();
	}

	public pushMessage(message: Message) {
		this.#cache.push(message);
	}

	public replaceAllMessages(messages: Message[] | MessageFetchResult) {
		const values = Array.isArray(messages) ? messages : messages.values();
		this.#cache = MinHeap.from(values, messageDateComparator);
	}

	public toString() {
		return `<ChannelTrimmingState size=${this.#cache.size}>`;
	}
}

class ChannelTrimmer {
	#channel: TextChannel;
	#state: ChannelTrimmingState;

	constructor(channel: TextChannel, duration: Temporal.Duration) {
		this.#channel = channel;
		this.#state = new ChannelTrimmingState(duration);
	}

	public async fetch() {
		const list = await this.#channel.messages.fetch({ cache: false, limit: 100, after: "0" });
		this.#state.replaceAllMessages(list);
		return true;
	}

	public get state() {
		return this.#state;
	}

	public get channel() {
		return this.#channel;
	}

	public get maxAge() {
		return this.#state.maxAge;
	}

	public toString() {
		return `<ChannelTrimmer channel=${this.#channel.id}=(${this.#channel.name}) state=${this.#state}>`;
	}
}

export default (bot: DiscordBot): void => {
	const trimmers = new Map<TextChannel, ChannelTrimmer>();
	let timer: NodeJS.Timeout;

	bot.discord.once("clientReady", () => {
		Object.entries(bot.config["trim-channels"])
			.map(([channelId, durationString]) => [bot.getTextChannel(channelId), Temporal.Duration.from(durationString)] as const)
			.forEach(([channel, duration]) => {
				if (channel)
					trimmers.set(channel, new ChannelTrimmer(channel, duration));
			});
	});

	/**
	 * WIP testing commands.
	 */
	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		if (msg.channelId === bot.config.channels.log && msg.content === "!trim fetch") {
			const reply = await msg.channel.send("fetching...");
			for (const [_, trimmer] of trimmers) {
				await trimmer.fetch();
				reply.edit("fetching... OK!");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim simulate") {
			for (const [channel, trimmer] of trimmers) {
				const message = trimmer.state.popOldMessage();
				channel.send(message ? `(task:delete:simulate) ${message.id}` : "(task:null)");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim step") {
			for (const [channel, trimmer] of trimmers) {
				const message = trimmer.state.popOldMessage();
				const reply = await channel.send(message ? `(task:delete) ${message.id}` : "(task:null)");
				await message.delete()
					.then(() => reply.edit(reply.content + " ... OK!"))
					.catch(err => reply.edit(reply.content + ` ... FAIL: ${err}`));
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim peek") {
			for (const [channel, trimmer] of trimmers) {
				const message = trimmer.state.peekMessage();
				channel.send(message ? `(task:peek) \`\`\`\n${message.content}\n\`\`\`\nAge: ${durationFormatter.format(durationSince(message.createdAt))} ${olderThan(message.createdAt, trimmer.maxAge) ? "🗑️" : "📜"}` : "(task:null)");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim") {
			for (const [channel, trimmer] of trimmers) {
				channel.send(`(task:info) ${trimmer}`);
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim timer=on") {
			timer = setInterval(() => trimmers.forEach(trimmer => trimmer.channel.send(`(timer:tick) trimmer: ${trimmer}`)), 60e3);
			await msg.channel.send("started");
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim timer=off") {
			clearInterval(timer);
			await msg.channel.send("stopped");
		}
	});
};
