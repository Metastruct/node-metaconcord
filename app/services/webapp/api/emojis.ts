import { DiscordBot } from "../../discord";
import { WebApp } from "..";

export default (webApp: WebApp): void => {
	let bot: DiscordBot;

	webApp.app.get("/discord/guild/emojis", async (_, res) => {
		bot = bot ?? webApp.container.getService("DiscordBot");
		if (!bot.discord.readyAt)
			return res.status(500).json({
				error: "Bot is not connected",
			});

		const guild = bot.getGuild();
		if (!guild) {
			return res.status(500).json({
				error: "Bot is not part of guild",
			});
		}

		const emojis = JSON.parse(JSON.stringify(guild.emojis.cache));
		for (const emoji of emojis) {
			const extension = emoji.animated ? "gif" : "png";
			emoji.url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?v=1`;
		}

		return res.status(200).json(emojis);
	});
};
