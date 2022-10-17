import { DiscordBot } from "..";
import { MessageCreateOptions } from "discord.js";
import { createCanvas, loadImage } from "canvas";

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

		if (mk && search && rng < 0.15 && !islast) {
			reply = `${search}? ${prefixes[Math.floor(rng * prefixes.length)]} "${mk}"`;
		} else {
			reply = mk;
		}
		return mk ? { content: reply } : undefined;
	} else {
		const images = bot.container.getService("Motd")?.images;
		if (images) {
			const imgur = images[Math.floor(rng * images.length)];
			const image = await loadImage(imgur.link);
			const canvas = createCanvas(image.width, image.height);
			const ctx = canvas.getContext("2d");
			const w = canvas.width;
			const h = canvas.height;
			ctx.globalCompositeOperation = "source-over";
			ctx.drawImage(image, 0, 0);
			ctx.globalCompositeOperation = "destination-out";
			ctx.beginPath();
			ctx.moveTo(0.05 * w, 0);
			ctx.quadraticCurveTo(0.05 * w, 0.1 * h, 0.55 * w, 0.1 * h);
			ctx.quadraticCurveTo(0.6 * w, 0.1 * h, 0.5 * w, 0.2 * h);
			ctx.quadraticCurveTo(0.7 * w, 0.2 * h, 0.7 * w, 0.1 * h);
			ctx.quadraticCurveTo(0.95 * w, 0.1 * h, 0.95 * w, 0);
			ctx.fill();

			const result = canvas.toBuffer();
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
