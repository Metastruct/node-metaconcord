import { type GuildEmoji } from "discord.js";

import { type WebApp } from "#/app/services/webapp/index.js";

type EmojiJSON = Pick<GuildEmoji, "animated" | "name" | "id" | "requiresColons" | "managed" | "available" | "createdTimestamp" | "identifier">
	& { guildId: string, author: null, imageURL: string };
type EmojiJSONWithUrl = EmojiJSON & { url: string };

export default async function addEmojiAPI(webApp: WebApp): Promise<void> {
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

		const emojis: EmojiJSONWithUrl[] = guild.emojis.cache.map(emoji => Object.assign({},
			emoji.toJSON() as EmojiJSON,
			{
				url: `https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}?v=1`,
			}));

		res.status(200).json(emojis);
	});
}
