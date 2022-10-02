import { DiscordBot } from "..";
import axios from "axios";
import motdConfig from "@/config/motd.json";

export default (bot: DiscordBot): void => {
	bot.discord.on("messageCreate", async msg => {
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}
		const id = bot.discord.user?.id;
		if (!id) return;
		if (!(msg.mentions.repliedUser?.id === id) || !(msg.mentions.users.first()?.id === id))
			return;
		if (!bot.config.allowedShitpostingChannels.includes(msg.channelId) || msg.author.bot)
			return;
		const rng = Math.random();

		let reply = "";

		if (rng > 0.4) {
			const mk = await bot.container.getService("Markov")?.generate();
			if (mk) reply = mk;
		} else {
			// todo: make an image cache from Motd.ts when it fetches the images instead.
			const res = await axios.get(
				`https://api.imgur.com/3/album/${motdConfig.imgurAlbumId}/images`,
				{
					headers: {
						Authorization: `Client-ID ${motdConfig.imgurClientId}`,
					},
				}
			);
			if (res.status === 200) {
				const urls: Array<any> = res.data.data;
				const image = urls[Math.floor(Math.random() * urls.length)];
				reply = image.link;
			}
		}

		if (reply !== "") {
			await msg.reply(reply);
		}
	});
};
