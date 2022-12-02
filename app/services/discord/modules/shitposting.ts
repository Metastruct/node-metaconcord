import { DiscordBot } from "..";
import { EmojiIdentifierResolvable, Message } from "discord.js";
import { MessageCreateOptions } from "discord.js";
import { makeSpeechBubble } from "@/utils";
import EmojiList from "unicode-emoji-json/data-ordered-emoji.json";

const MSG_IDLE_INTERVAL = 1000 * 60 * 60 * 1; // 60 min
const MSG_INTERVAL = 1000 * 60 * 60 * 0.5; // 30 min
const REACTION_FREQ = 0.025;

export const Shat = async (
	bot: DiscordBot,
	msg?: string,
	forceImage?: boolean,
	forceReply?: boolean
): Promise<MessageCreateOptions | undefined> => {
	const rng = Math.random();
	if (rng > 0.05 && !forceImage) {
		let search: string | undefined;
		let fallback: string | undefined;
		let islast = false;
		if (msg && !msg.startsWith("http") && (rng >= 0.5 || forceReply)) {
			const words = msg.replace(`<@${bot.discord.user?.id}> `, "").split(" ");
			const index = Math.floor(rng * words.length);
			islast = index + 1 === words.length;
			if (!islast) {
				search = words.slice(index, index + 2).join(" ");
				fallback = words[index];
			} else {
				search = words[index];
			}
		}
		let mk = await bot.container.getService("Markov")?.generate(search, {
			continuation: !(islast && rng >= 0.75),
		});

		if (!mk && fallback) mk = await bot.container.getService("Markov")?.generate(fallback);
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
	const data = bot.container.getService("Data");
	if (!data) return;
	let lastMkTime = data.lastMkTime ?? 0;
	let posting = false;
	let replied = false;

	const sendShat = async (msg?: Message, forceReply?: boolean, ping?: boolean) => {
		posting = true;
		const shat = await Shat(bot, msg?.content, undefined, forceReply);
		if (shat) {
			if (msg) {
				await msg.reply({
					...shat,
					allowedMentions: ping ? { repliedUser: true } : { repliedUser: false },
				});
			} else {
				await (await bot.getTextChannel(bot.config.chatChannelId))?.send(shat);
			}

			data.lastMkTime = lastMkTime = Date.now();
			await data.save();
		}
		posting = false;
	};

	const getRandomEmoji = () => {
		let emoji: EmojiIdentifierResolvable;
		if (Math.random() <= 0.5) {
			emoji = bot.discord.guilds.cache
				.get(bot.config.guildId)
				?.emojis.cache.random() as EmojiIdentifierResolvable;
		} else {
			emoji = EmojiList[Math.floor(Math.random() * EmojiList.length)];
		}
		return emoji;
	};

	// shitpost channel
	bot.discord.on("messageCreate", async msg => {
		if (!bot.config.allowedShitpostingChannels.includes(msg.channelId) || msg.author.bot)
			return;
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}
		const id = bot.discord.user?.id;
		if (!id) return;
		if (
			Math.random() <= REACTION_FREQ &&
			msg.mentions.users.first()?.id !== bot.discord.user?.id
		) {
			setTimeout(async () => msg.react(getRandomEmoji()), 1000 * 10);
		}
		if (!(msg.mentions.users.first()?.id === id)) return;
		const shat = await Shat(bot, msg.content);
		if (shat) await msg.reply(shat);
	});
	// chat channel
	setInterval(async () => {
		if (Date.now() - lastMkTime > MSG_IDLE_INTERVAL && !posting) {
			await sendShat();
		}
	}, 1000 * 60 * 15);

	bot.discord.on("messageReactionAdd", async reaction => {
		if (
			reaction.message.channelId !== bot.config.chatChannelId &&
			!bot.config.allowedShitpostingChannels.includes(reaction.message.channelId)
		)
			return;
		if (Math.random() >= 0.75) reaction.react();
	});

	bot.discord.on("messageReactionRemove", async reaction => {
		if (
			reaction.message.channelId !== bot.config.chatChannelId &&
			!bot.config.allowedShitpostingChannels.includes(reaction.message.channelId)
		)
			return;
		if (reaction.me && reaction.count && reaction.count <= 2)
			reaction.users.remove(reaction.client.user);
	});

	bot.discord.on("messageCreate", async msg => {
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}
		if (
			msg.channelId !== bot.config.chatChannelId ||
			msg.author.bot ||
			msg.content.length === 0
		)
			return;

		const its_posting_time = Date.now() - lastMkTime > MSG_INTERVAL;
		if (
			!its_posting_time &&
			(Math.random() <= REACTION_FREQ ||
				(replied && msg.mentions.users.first()?.id === bot.discord.user?.id))
		) {
			setTimeout(async () => msg.react(getRandomEmoji()), 1000 * 10);
		}
		if (its_posting_time && !posting) {
			await sendShat(msg, true);
			replied = false;
		} else if (
			!its_posting_time &&
			!replied &&
			!posting &&
			msg.mentions.users.first()?.id === bot.discord.user?.id &&
			msg.content !== "<@427261532284387329>"
		) {
			await sendShat(msg, true, true);
			replied = true;
		}
	});
};
