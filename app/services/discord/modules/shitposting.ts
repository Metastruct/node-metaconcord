import { DiscordBot } from "..";
import { MessageCreateOptions } from "discord.js";
import { makeSpeechBubble } from "@/utils";

const prefixes = ["more like", "you mean"];

export const Shat = async (
	bot: DiscordBot,
	msg: string
): Promise<MessageCreateOptions | undefined> => {
	const rng = Math.random();
	if (rng > 0.15) {
		let search: string | undefined;
		let islast = false;
		let reply: string | undefined;
		if (!msg.startsWith("http") && rng >= 0.5) {
			const words = msg.replace(`<@${bot.discord.user?.id}>`, "").split(" ");
			const index = Math.floor(rng * words.length);
			islast = index === words.length;
			search = words[index];
		}
		const mk = await bot.container.getService("Markov")?.generate(search, {
			continuation: !islast,
		});

		if (mk && search && rng < 0.2 && !islast) {
			reply = `${search}? ${prefixes[Math.floor(rng * prefixes.length)]} "${mk}"`;
		} else {
			reply = mk;
		}
		return mk ? { content: reply } : undefined;
	} else {
		const images = bot.container.getService("Motd")?.images;
		if (images) {
			const imgur = images[Math.floor(rng * images.length)];
			const result = await makeSpeechBubble(imgur.link);
			return result ? { files: [result] } : undefined;
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
		if (
			!bot.config.allowedShitpostingChannels.includes(msg.channelId) ||
			msg.author.bot ||
			msg.content.length < (msg.mentions.repliedUser ? 2 : 20)
		)
			return;
		const shat = await Shat(bot, msg.content);
		if (shat) await msg.reply(shat);
	});
};
