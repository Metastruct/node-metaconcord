import { DiscordBot } from "..";

export default (bot: DiscordBot): void => {
	bot.discord.on("messageReactionAdd", async reaction => {
		if (reaction.partial) {
			try {
				reaction = await reaction.fetch();
			} catch {
				return;
			}
		}
		if (
			reaction.message.channel.id !== "324685126699188224" &&
			reaction.emoji.name !== "♻" &&
			reaction.count < 10
		)
			return;
		const lastmsg = await bot.getLastMotdMsg();
		if (!lastmsg) return; // could be undefined if the bot was just launched and the msg is not cached
		if (reaction.message.id !== lastmsg.id) return;
		if (!lastmsg.content.includes("Image of the day:")) return;
		await bot.container.getService("Motd").rerollImageJob();
	});
};
