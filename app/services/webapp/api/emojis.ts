import { WebApp } from "..";

export default (webApp: WebApp): void => {
	const { discord, config } = webApp.container.getService("DiscordBot");

	webApp.app.get("/discord/guild/emojis", async (_, res) => {
		if (!discord.readyAt)
			return res.status(500).json({
				error: "Bot is not connected",
			});

		const guild = await discord.guilds.resolve(config.guildId)?.fetch();
		if (!guild) {
			return res.status(500).json({
				error: "Bot is not part of guild",
			});
		}

		const emojis = JSON.parse(JSON.stringify(guild.emojis));
		for (const emoji of emojis) {
			const extension = emoji.animated ? "gif" : "png";
			emoji.url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?v=1`;
		}

		return res.status(200).json(emojis);
	});
};
