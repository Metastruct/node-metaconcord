import { TextChannel, Message } from "discord.js";
import { DiscordBot } from "../index.js";
import { MinHeap } from "mnemonist";
import { DateTimeIsh, dateTimeIshToZonedDateTime, dateTimeNow, formatDiscordAbsoluteTimestamp, logger, normalizeDuration } from "#/utils.js";

const log = logger(import.meta);

const INTERVAL = 1e3;
const DELAY = 30e3; // wait 30s before starting
const PIN_EDIT_INTERVAL = 5*60*1000;

type MessageFetchResult = Awaited<ReturnType<TextChannel["messages"]["fetch"]>>;

const durationSince = (time: DateTimeIsh) => dateTimeNow().since(dateTimeIshToZonedDateTime(time));

const isOlderThan = (instant: DateTimeIsh, duration: Temporal.Duration) =>
	Temporal.Duration.compare(durationSince(instant), duration, { relativeTo: Temporal.Now.plainDateISO() }) > 0;

const durationFormatter = new Intl.DurationFormat("en", { style: "long", fractionalDigits: 0 });
const roundToDays = (duration: Temporal.Duration) => duration.round({ smallestUnit: "days", largestUnit: "years", relativeTo: Temporal.Now.plainDateISO() });
const messageDateComparator = (a: Message, b: Message) => a.createdAt.getTime() - b.createdAt.getTime();

class ChannelTrimmingState {
	#maxAge: Temporal.Duration;
	#cache: MinHeap<Message>;
	#fetchTimestamp: string;

	constructor(duration: Temporal.Duration) {
		this.#maxAge = duration;
		this.#cache = new MinHeap<Message>(messageDateComparator);
		this.#fetchTimestamp = "0";
	}

	public get maxAge() {
		return this.#maxAge;
	}

	public get size() {
		return this.#cache.size;
	}

	public get fetchTimestamp() {
		return this.#fetchTimestamp;
	}

	public popOldMessage() {
		const top = this.#cache.peek();
		if (top && isOlderThan(top.createdAt, this.#maxAge)) {
			this.#fetchTimestamp = top.id;
			return this.#cache.pop();
		}
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
		return `<ChannelTrimmingState size=${this.#cache.size} maxAge=${durationFormatter.format(this.#maxAge)} timestamp=${this.#fetchTimestamp}>`;
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
		log.debug(`Fetching 100 messages in ${this}`);
		const list = await this.#channel.messages.fetch({ cache: false, limit: 100, after: this.#state.fetchTimestamp });
		this.#state.replaceAllMessages(list);
		return true;
	}

	public async fetchIfEmpty() {
		if (this.#state.size === 0)
			await this.fetch();
	}

	public async trim() {
		await this.fetchIfEmpty();
		const candidate = this.#state.popOldMessage();
		if (candidate && !candidate.pinned) {
			await candidate.delete();
			return candidate;
		}
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

const formatStatsLine = (trimmer: ChannelTrimmer) =>
	`Max Age: ${durationFormatter.format(roundToDays(trimmer.maxAge))}\n` +
	`Cut-off: ${formatDiscordAbsoluteTimestamp(dateTimeNow().subtract(trimmer.maxAge))}\n` +
	`Fetch snowflake: ${trimmer.state.fetchTimestamp}\n` +
	`Peek: ${trimmer.state.peekMessage().url}`;

export default function ChannelTrimmerLoader(bot: DiscordBot): void {
	const trimmers = new Map<TextChannel, ChannelTrimmer>();

	let timerEnabled = true;

	function timerFunc() {
		if (!timerEnabled) return;
		Promise.all(trimmers.values().map(trimmer => trimmer.trim()))
			.then(() => setTimeout(timerFunc, INTERVAL));
	}

	function enableTimer() {
		if (!timerEnabled) {
			timerEnabled = true;
			timerFunc();
		}
	}

	function disableTimer() {
		timerEnabled = false;
	}

	async function updateStatusMessages() {
		for (const [channel, trimmer] of trimmers) {
			const pinnedMessages = await channel.messages.fetchPins();
			const statusMessage = pinnedMessages.items.map(messagePin => messagePin.message).find(message => message.author.id === bot.discord.user?.id);
			if (!statusMessage) return;
			await statusMessage.edit(formatStatsLine(trimmer));
		}
	};

	bot.discord.once("clientReady", () => {
		Object.entries(bot.config["trim-channels"])
			.map(([channelId, durationString]) => [bot.getTextChannel(channelId), normalizeDuration(Temporal.Duration.from(durationString))] as const)
			.filter(([channel]) => !!channel)
			.forEach(([channel, duration]) => {
				trimmers.set(channel, new ChannelTrimmer(channel, duration));
			});
		setTimeout(timerFunc, DELAY);
		setInterval(updateStatusMessages, PIN_EDIT_INTERVAL);
	});

	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		if (msg.channelId === bot.config.channels.log && msg.content === "!trim") {
			for (const [channel, trimmer] of trimmers) {
				channel.send(`(task:info) ${trimmer} TIMER=${timerEnabled}`);
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim on") {
			enableTimer();
			await msg.channel.send("started");
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim off") {
			disableTimer();
			await msg.channel.send("stopped");
		}
	});
}
