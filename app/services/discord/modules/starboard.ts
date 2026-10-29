import { type MessageReaction } from "discord.js";

import { type DiscordBot } from "../index.js";

export default function StarboardLoader(bot: DiscordBot): void {
	bot.discord.on("messageReactionAdd", async reaction => {
		if (reaction.partial) {
			try {
				reaction = await reaction.fetch();
			} catch {
				return;
			}
		}
		await bot.container
			.getService("Starboard")
			.handleReactionAdded(reaction as MessageReaction);
	});
}
