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
	

	/**
	 * popOldMessage
	 */
	public popOldMessage() {
		const top = this.#cache.peek();
		if (top && olderThan(top.createdAt, this.#maxAge))
			return this.#cache.pop();
	}

	/**
	 * peekMessage
	 */
	public peekMessage() {
		return this.#cache.peek();
	}

	/**
	 * pushMessage
	 */
	public pushMessage(message: Message) {
		this.#cache.push(message);
	}

	/**
	 * replaceAllMessages
	 */
	public replaceAllMessages(messages: Message[] | MessageFetchResult) {
		const values = Array.isArray(messages) ? messages : messages.values();
		this.#cache = MinHeap.from(values, messageDateComparator);
	}
}

export default (bot: DiscordBot): void => {
	const channelStates = new Map<TextChannel, ChannelTrimmingState>();

	bot.discord.once("clientReady", () => {
		Object.entries(bot.config["trim-channels"])
			.map(([channelId, durationString]) => [bot.getTextChannel(channelId), Temporal.Duration.from(durationString)] as const)
			.forEach(([channel, duration]) => {
				if (channel)
					channelStates.set(channel, new ChannelTrimmingState(duration));
			});
	});

	/**
	 * WIP testing commands.
	 */
	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		if (msg.channelId === bot.config.channels.log && msg.content === "!trim fetch") {
			const reply = await msg.channel.send("fetching...");
			for (const [channel, state] of channelStates) {
				const list = await channel.messages.fetch({ cache: false, limit: 100, after: "0" });
				state.replaceAllMessages(list);
				reply.edit("fetching... OK!");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim simulate") {
			for (const [channel, state] of channelStates) {
				const message = state.popOldMessage();
				channel.send(message ? `(task:delete:simulate) ${message.id}` : "(task:null)");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim step") {
			for (const [channel, state] of channelStates) {
				const message = state.popOldMessage();
				const reply = await channel.send(message ? `(task:delete) ${message.id}` : "(task:null)");
				await message.delete()
					.then(() => reply.edit(reply.content + " ... OK!"))
					.catch(err => reply.edit(reply.content + ` ... FAIL: ${err}`));
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim peek") {
			for (const [channel, state] of channelStates) {
				const message = state.peekMessage();
				channel.send(message ? `(task:peek) \`\`\`\n${message.content}\n\`\`\`\nAge: ${durationFormatter.format(durationSince(message.createdAt))} ${olderThan(message.createdAt, state.maxAge) ? "🗑️" : "📜"}` : "(task:null)");
			};
		}
	});
};
