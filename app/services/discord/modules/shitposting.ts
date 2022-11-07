import { DiscordBot } from "..";
import { MessageCreateOptions } from "discord.js";
import { makeSpeechBubble } from "@/utils";

export const Shat = async (
	bot: DiscordBot,
	msg?: string,
	forceImage?: boolean
): Promise<MessageCreateOptions | undefined> => {
	const rng = Math.random();
	if (rng > 0.05 && !forceImage) {
		let search: string | undefined;
		let islast = false;
		if (msg && !msg.startsWith("http") && rng >= 0.5) {
			const words = msg.replace(`<@${bot.discord.user?.id}>`, "").split(" ");
			const index = Math.floor(rng * words.length);
			islast = index + 1 === words.length;
			search = words[index];
		}
		let mk = await bot.container.getService("Markov")?.generate(search, {
			continuation: !(islast && rng >= 0.75),
		});

		if (!mk) mk = await bot.container.getService("Markov")?.generate();

		return mk ? { content: mk } : undefined;
	} else {
		const rng2 = Math.random();
		const images = bot.container.getService("Motd")?.images;
		if (images) {
			const imgur = images[Math.floor(rng2 * images.length)];
			const result = await makeSpeechBubble(imgur.link, rng2 >= 0.5);
			return result
				? { files: [{ attachment: result, description: imgur.title }] }
				: undefined;
		}
	}
};

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
		if (!(msg.mentions.users.first()?.id === id)) return;
		if (!bot.config.allowedShitpostingChannels.includes(msg.channelId) || msg.author.bot)
			return;
		const shat = await Shat(bot, msg.content);
		if (shat) await msg.reply(shat);
	});
};
