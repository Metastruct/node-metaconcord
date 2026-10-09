import { TextChannel } from "discord.js";
import { DiscordBot } from "../index.js";

const instantFromDate = (date: Date) => Temporal.Instant.fromEpochMilliseconds(date.getTime());
const now = () => Temporal.Now.instant();
const durationSince = (time: Temporal.Instant) => now().since(time);
const olderThan = (instant: Temporal.Instant, duration: Temporal.Duration) =>
	Temporal.Duration.compare(durationSince(instant), duration, { relativeTo: Temporal.Now.plainDateISO() }) > 0;

const durationFormatter = new Intl.DurationFormat("en", { style: "digital" });

export default (bot: DiscordBot): void => {
	const channelMap = new Map<TextChannel, Temporal.Duration>();

	bot.discord.once("clientReady", () => {
		Object.entries(bot.config["trim-channels"])
			.map(([channelId, durationString]) => [bot.getTextChannel(channelId), Temporal.Duration.from(durationString)] as const)
			.forEach(([channel, duration]) => channelMap.set(channel, duration));
	});

	/**
	 * WIP testing commands.
	 */
	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		if (msg.channelId === bot.config.channels.log && msg.content === "!trim index") {
			await msg.channel.send("fetching...");
			for (const [channel, threshold] of channelMap) {
				const list = await channel.messages.fetch({ cache: false, limit: 20, after: "0" });
				const summary = list
					.map(m => ({...m, instant: instantFromDate(m.createdAt)}))
					.map(m => `DATE = ${m.instant} ; DELTA = ${durationSince(m.instant)} = ${durationFormatter.format(durationSince(m.instant))} ; CONTENT = ${m.content} ; DELETE: ${olderThan(m.instant, threshold) ? "🗑️" : "📜"}`)
					.join("\n");
				await msg.channel.send(summary);
			};
		} else if (msg.channelId === bot.config.channels.log && msg.content === "!trim index recent") {
			await msg.channel.send("fetching...");
			for (const [channel, threshold] of channelMap) {
				const list = await channel.messages.fetch({ cache: false, limit: 20 });
				const summary = list
					.map(m => ({...m, instant: instantFromDate(m.createdAt)}))
					.map(m => `DATE = ${m.instant} ; DELTA = ${durationSince(m.instant)} = ${durationFormatter.format(durationSince(m.instant))} ; CONTENT = ${m.content} ; DELETE: ${olderThan(m.instant, threshold) ? "🗑️" : "📜"}`)
					.join("\n");
				await msg.channel.send(summary);
			};
		}
	});
};
