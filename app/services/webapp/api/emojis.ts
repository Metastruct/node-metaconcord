import { WebApp } from "#/app/services/webapp/index.js";
import { GuildEmoji } from "discord.js";

type EmojiWithUrl = GuildEmoji & { url: string };

export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/discord/guild/emojis", async (_, res) => {
		const bot = webApp.container.getService("DiscordBot");
		if (!bot.discord.readyAt) {
			res.status(500).json({
				error: "Bot is not connected",
			});
			return;
		}

		const guild = bot.getGuild();
		if (!guild) {
			res.status(500).json({
				error: "Bot is not part of guild",
			});
			return;
		}

		const emojis: EmojiWithUrl[] = structuredClone(guild.emojis.cache.values().toArray());
		for (const emoji of emojis) {
			emoji.url = `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?v=1`;
		}

		res.status(200).json(emojis);
	});
};
