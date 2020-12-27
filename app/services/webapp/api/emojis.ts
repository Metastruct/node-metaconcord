import WebApp from "../WebApp";
import discordConfig from "@/discord.json";

export default (webApp: WebApp): void => {
	webApp.app.get("/discord/guild/emojis", (_, res) => {
		const client = webApp.discord.client;
		if (!client.gateway.connected)
			return res.status(500).json({
				error: "Bot is not connected",
			});

		const guild = client.guilds.get(discordConfig.guildId);
		if (!guild)
			return res.status(500).json({
				error: "Bot is not part of guild",
			});

		const emojis = JSON.parse(JSON.stringify(guild.emojis));
		for (const emoji of emojis) {
			const extension = emoji.animated ? "gif" : "png";
			emoji.url = `https://cdn.discordapp.com/emojis/${emoji.id}.${extension}?v=1`;
		}

		return res.status(200).json(emojis);
	});
};
