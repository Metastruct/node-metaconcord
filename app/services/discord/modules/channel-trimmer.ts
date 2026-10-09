import { TextChannel } from "discord.js";
import { DiscordBot } from "../index.js";

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
			for (const [channel, _duration] of channelMap) {
				const list = await channel.messages.fetch({ cache: false, limit: 10, after: "0" });
				const summary = list.map(m => m.content).join("\n");
				await msg.channel.send(summary);
			};
		}
	});
};
