import { DiscordBot } from "../index.js";
import { MessageReaction } from "discord.js";

export default (bot: DiscordBot): void => {
	bot.discord.on("messageReactionAdd", async reaction => {
		if (reaction.partial) {
			try {
				reaction = await reaction.fetch();
			} catch {
				return;
			}
		}
		await (
			await bot.container.getService("Starboard")
		).handleReactionAdded(reaction as MessageReaction);
	});
};
