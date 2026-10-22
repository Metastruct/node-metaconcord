import { TextChannel, Message } from "discord.js";
import { DiscordBot } from "../index.js";
import { MinHeap } from "mnemonist";
import { logger } from "#/utils.js";
import { SQL } from "#/app/services/index.js";

const log = logger(import.meta);

const INTERVAL = 1e3;
const DELAY = 30e3; // wait 30s before starting
const PIN_EDIT_INTERVAL = 5*60*1000;
const PROGRESS_TABLE = "channeltrimmer_progress";
const TOTAL_KEY = "total";
const DELETED_KEY = "deleted";
const STARTED_AT_KEY = "started_at";

type Timestamp = Date | Temporal.Instant;
type MessageFetchResult = Awaited<ReturnType<TextChannel["messages"]["fetch"]>>;
type ProgressRow = {
	value: number;
};

type TrimStats = {
	deleted: number;
	total: number;
	percentage: number;
	startedAt: Temporal.Instant | null;
	remainingDuration: Temporal.Duration | null;
};

const Instant = (timestamp: Timestamp) => timestamp instanceof Date ? timestamp.toTemporalInstant() : timestamp;

const durationSince = (time: Timestamp) => Temporal.Now.instant().since(Instant(time)).round({ largestUnit: "year", relativeTo: Temporal.Now.plainDateISO() });
const olderThan = (instant: Timestamp, duration: Temporal.Duration) =>
	Temporal.Duration.compare(durationSince(instant), duration, { relativeTo: Temporal.Now.plainDateISO() }) > 0;

const durationFormatter = new Intl.DurationFormat("en", { style: "digital" });
const messageDateComparator = (a: Message, b: Message) => a.createdAt.getTime() - b.createdAt.getTime();

const formatEta = (remainingDuration: Temporal.Duration | null) =>
	remainingDuration ? `ETA: ${durationFormatter.format(remainingDuration.round({ largestUnit: "day" }))}` : "ETA: unknown";

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
		if (top && olderThan(top.createdAt, this.#maxAge)) {
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

class ChannelTrimmerProgressStore {
	#sql: SQL;

	constructor(sql: SQL) {
		this.#sql = sql;
		this.#sql.execLocal(`
			CREATE TABLE IF NOT EXISTS ${PROGRESS_TABLE} (
				textchannel_id TEXT NOT NULL,
				key TEXT NOT NULL,
				value INTEGER NOT NULL DEFAULT 0,
				PRIMARY KEY (textchannel_id, key)
			);
		`);
	}

	public getValue(channelId: string, key: string) {
		return this.#sql.getLocal<ProgressRow>(
			`SELECT value FROM ${PROGRESS_TABLE} WHERE textchannel_id = ? AND key = ? LIMIT 1;`,
			channelId,
			key,
		)?.value ?? 0;
	}

	public setValue(channelId: string, key: string, value: number) {
		this.#sql.runLocal(
			`INSERT INTO ${PROGRESS_TABLE}(textchannel_id, key, value) VALUES(?, ?, ?)
			 ON CONFLICT(textchannel_id, key) DO UPDATE SET value = excluded.value;`,
			channelId,
			key,
			value,
		);
	}

	public incrementValue(channelId: string, key: string, amount = 1) {
		this.#sql.runLocal(
			`INSERT INTO ${PROGRESS_TABLE}(textchannel_id, key, value) VALUES(?, ?, ?)
			 ON CONFLICT(textchannel_id, key) DO UPDATE SET value = value + excluded.value;`,
			channelId,
			key,
			amount,
		);
	}

	public setTotal(channelId: string, total: number) {
		this.setValue(channelId, TOTAL_KEY, total);
	}

	public incrementDeleted(channelId: string) {
		this.incrementValue(channelId, DELETED_KEY);
	}

	public getStats(channelId: string): TrimStats {
		const deletedCnt = this.getValue(channelId, DELETED_KEY);
		const totalCnt = this.getValue(channelId, TOTAL_KEY);
		const startedAt = this.getValue(channelId, STARTED_AT_KEY);
		const percentage = totalCnt > 0 ? deletedCnt / totalCnt * 100 : 0;
		const remainingCnt = Math.max(totalCnt - deletedCnt, 0);
		const elapsedDuration = Date.now() - (startedAt ?? 0);
		const remainingDuration = Math.floor(elapsedDuration / deletedCnt * remainingCnt);
		return {
			deleted: deletedCnt,
			total: totalCnt,
			percentage,
			startedAt: Temporal.Instant.fromEpochMilliseconds(startedAt ?? 0),
			remainingDuration: Temporal.Duration.from({ milliseconds: remainingDuration })
				.round({ largestUnit: "year", relativeTo: Temporal.Now.plainDateISO() })
		};
	}
}

class ChannelTrimmer {
	#channel: TextChannel;
	#state: ChannelTrimmingState;
	#progressStore: ChannelTrimmerProgressStore;

	constructor(channel: TextChannel, duration: Temporal.Duration, progressStore: ChannelTrimmerProgressStore) {
		this.#channel = channel;
		this.#state = new ChannelTrimmingState(duration);
		this.#progressStore = progressStore;
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
			this.#progressStore.incrementDeleted(this.#channel.id);
			return candidate;
		}
	}

	public setTotal(total: number) {
		this.#progressStore.setTotal(this.#channel.id, total);
	}

	public getStats() {
		return this.#progressStore.getStats(this.#channel.id);
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

const formatStatsLine = (_channel: TextChannel, stats: TrimStats) =>
	`deleted ${stats.deleted}/${stats.total} (${stats.percentage.toFixed(2)}%) ${formatEta(stats.remainingDuration)}`;

export default (bot: DiscordBot): void => {
	const trimmers = new Map<TextChannel, ChannelTrimmer>();
	const progressStore = new ChannelTrimmerProgressStore(bot.container.getService("SQL"));

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
			await statusMessage.edit(formatStatsLine(trimmer.channel, trimmer.getStats()));
		}
	};

	bot.discord.once("clientReady", () => {
		Object.entries(bot.config["trim-channels"])
			.map(([channelId, durationString]) => [bot.getTextChannel(channelId), Temporal.Duration.from(durationString)] as const)
			.filter(([channel]) => !!channel)
			.forEach(([channel, duration]) => {
				trimmers.set(channel, new ChannelTrimmer(channel, duration, progressStore));
			});
		setTimeout(timerFunc, DELAY);
		setInterval(updateStatusMessages, PIN_EDIT_INTERVAL);
	});

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
				const message = trimmer.state.peekMessage();
				const reply = await channel.send(message ? `(task:step) ${message.id} ${message.url}` : "(task:null)");
				await trimmer.trim()
					.then(() => reply.edit(reply.content + " ... OK!"))
					.catch(error => reply.edit(reply.content + ` ... FAIL: ${error}`));
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim peek") {
			for (const [channel, trimmer] of trimmers) {
				const message = trimmer.state.peekMessage();
				channel.send(message ? `(task:peek) \`\`\`\n${message.content}\n\`\`\`\nURL: ${message.url}\nAge: ${durationFormatter.format(durationSince(message.createdAt))} ${olderThan(message.createdAt, trimmer.maxAge) ? "🗑️" : "📜"}` : "(task:null)");
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim stats") {
			const lines = trimmers.entries().map(([channel, trimmer]) => formatStatsLine(channel, trimmer.getStats())).toArray();
			await msg.channel.send(lines.length > 0 ? lines.join("\n") : "No trimmers configured.");
		} else if (msg.channelId === bot.config.channels.log && msg.content.startsWith("!trim set-total ")) {
			const total = Math.trunc(Number(msg.content.slice("!trim set-total ".length).trim()));
			if (!Number.isFinite(total) || total < 0) {
				await msg.channel.send("invalid total");
				return;
			}

			for (const [channel, trimmer] of trimmers) {
				trimmer.setTotal(total);
				await msg.channel.send(`${channel}: total set to ${total}`);
			}
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim") {
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
};
