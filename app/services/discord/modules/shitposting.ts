import { ActivitiesOptions, EmojiIdentifierResolvable, Message } from "discord.js";
import { DiscordBot } from "..";
import { MessageCreateOptions } from "discord.js";
import { makeSpeechBubble } from "@/utils";
import EmojiList from "unicode-emoji-json/data-ordered-emoji.json";

const MSG_INTERVAL = 1000 * 60 * 1; // msg check
const MSG_TRIGGER_COUNT = 10; // how many msgs in msg check until a msg is posted
const MSG_CHAT_INTERVAL = 1000 * 60 * 60; // 1 hr
const MSG_REPLY_INTERVAL = 1000 * 60 * 2;
const MSG_DEAD_CHAT_REVIVAL_INTERVAL = 1000 * 60 * 60 * 0.5; // 30 min
const MSG_RNG = 0.1; // random messges that defy intervals
const ACTIVITY_CHANGE_INTERVAL = 1000 * 60 * 10; // also saves lastmsg/mk at that interval
const REACTION_FREQ = 0.01;

const TRIGGER_WORDS = ["meta bot", "the bot", "metaconcord"];

export const Shat = async (
	bot: DiscordBot,
	msg?: string,
	forceImage?: boolean,
	forceReply?: boolean
): Promise<MessageCreateOptions | undefined> => {
	const rng = Math.random();
	if (rng > 0.05 && !forceImage && !msg?.startsWith("http")) {
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
		// continuation: !(islast && rng >= 0.75),
		let mk = await bot.container.getService("Markov")?.generate(search, {
			continuation: true,
		});

		if (!mk && fallback) mk = await bot.container.getService("Markov")?.generate(fallback);
		if (!mk) mk = await bot.container.getService("Markov")?.generate();

		return mk ? { content: mk.replace(`<@${bot.discord.user?.id}> `, "") } : undefined;
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
	let lastMkTime = (data.lastMkTime = data.lastMkTime ?? Date.now());
	let lastMsgTime = (data.lastMsgTime = data.lastMsgTime ?? Date.now());
	let lastChatTime = Date.now();
	const lastMsgs: Message<boolean>[] = [];
	let posting = false;
	let replied = false;

	const sendShat = async (
		options: {
			msg?: Message;
			forceImage?: boolean;
			forceReply?: boolean;
			ping?: boolean;
			dont_save?: boolean;
		} = {}
	) => {
		posting = true;
		const shat = await Shat(bot, options.msg?.content, options.forceImage, options.forceReply);
		if (shat) {
			if (options.msg) {
				await options.msg.reply({
					...shat,
					allowedMentions: options.ping ? { repliedUser: true } : { repliedUser: false },
				});
			} else {
				await (await bot.getTextChannel(bot.config.chatChannelId))?.send(shat);
			}
			if (!options.dont_save) {
				data.lastMkTime = lastMkTime = Date.now();
			}
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

	const getRandomStatus = async () => {
		const validActivities = [
			{ type: 0, ctx: ["playing"] },
			{
				type: 1,
				ctx: ["streaming", "sending", "delivering", "transporting", "transmitting"],
			},
			{ type: 2, ctx: ["listening to", "hearing"] },
			{ type: 3, ctx: ["watching", "watch", "looking at", "observing"] },
			{ type: 5, ctx: ["competing in", "participate in", "take part in"] },
		];

		const selection = validActivities[Math.floor(Math.random() * validActivities.length)];

		let status = "crashing the source engine";

		const sentence = await bot.container
			.getService("Markov")
			?.generate(selection.ctx[Math.floor(Math.random() * selection.ctx.length)], {
				continuation: false,
			});
		if (sentence) {
			status = sentence.length > 127 ? sentence.substring(0, 120) + "..." : sentence;
		}

		return { name: status, type: selection.type } as ActivitiesOptions; // who cares
	};

	bot.discord.on("ready", async () => {
		setInterval(async () => {
			bot.setActivity(undefined, await getRandomStatus());
			await data.save();
		}, ACTIVITY_CHANGE_INTERVAL); // change status every 10mins and save data
		bot.setActivity(undefined, await getRandomStatus());

		setInterval(async () => {
			if (
				lastMsgs.length > 0 &&
				lastMsgs.slice(-1)[0].author.id !== bot.discord.user?.id &&
				(Date.now() - lastChatTime > MSG_DEAD_CHAT_REVIVAL_INTERVAL ||
					lastMsgs.length - 4 >= MSG_TRIGGER_COUNT ||
					Date.now() - lastMsgTime > MSG_CHAT_INTERVAL) &&
				!posting
			) {
				await sendShat({
					dont_save: true,
					msg: Math.random() >= 0.5 ? lastMsgs.slice(-1)[0] : undefined,
				});
				data.lastMsgTime = lastMsgTime = Date.now();
			}
			lastMsgs.splice(0, lastMsgs.length - 4); // delete lastmsg cache except the last four msgs
		}, MSG_INTERVAL);
	});

	bot.discord.on("messageDelete", async msg => {
		if (msg.channelId !== bot.config.chatChannelId) return;
		const idx = lastMsgs.indexOf(msg as Message);
		if (idx !== -1) lastMsgs.splice(idx, 1);
	});

	bot.discord.on("messageCreate", async msg => {
		const id = bot.discord.user?.id;
		if (!id) return;

		if (msg.author.bot && msg.author.id !== id) return;
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}

		// Message Reactions
		if (
			(msg.author.id !== id &&
				Math.random() <= REACTION_FREQ &&
				msg.mentions.users.first()?.id !== bot.discord.user?.id) ||
			(msg.author.id !== id &&
				bot.config.chatChannelId !== msg.channelId &&
				TRIGGER_WORDS.some(str => msg.content.toLowerCase().includes(str)))
		) {
			setTimeout(async () => msg.react(getRandomEmoji()), 1000 * 10);
		}

		// #shitpost channel
		if (
			msg.author.id !== id &&
			(msg.mentions.users.first()?.id === id ||
				TRIGGER_WORDS.some(str => msg.content.toLowerCase().includes(str))) &&
			bot.config.allowedShitpostingChannels.includes(msg.channelId)
		) {
			const shat = await Shat(bot, msg.content);
			if (shat) await msg.reply(shat);
		}

		// #chat channel
		if (bot.config.chatChannelId === msg.channelId) {
			lastChatTime = Date.now();
			lastMsgs.push(msg);
		}

		if (
			msg.author.id !== id &&
			(msg.mentions.users.first()?.id === id ||
				TRIGGER_WORDS.some(str => msg.content.toLowerCase().includes(str)) ||
				(lastMsgs.length > 1 &&
					lastMsgs.slice(-4)[0].author.id !== id &&
					(msg.mentions.repliedUser
						? msg.mentions.repliedUser.id === id
						: true && msg.mentions.users.size > 0
						? msg.mentions.users.first()?.id === id
						: true))) &&
			bot.config.chatChannelId === msg.channelId
		) {
			const its_posting_time = Date.now() - lastMkTime > MSG_REPLY_INTERVAL;
			if ((its_posting_time || Math.random() <= MSG_RNG) && !posting) {
				await sendShat(
					msg.stickers.size > 0
						? { forceImage: true, forceReply: true }
						: { msg: msg, forceReply: true }
				);
				replied = false;
				data.lastMsgTime = lastMsgTime = Date.now();
			} else if (
				!its_posting_time &&
				(!replied || Math.random() <= MSG_RNG) &&
				!posting &&
				((msg.mentions.users.first()?.id === bot.discord.user?.id &&
					msg.content !== "<@427261532284387329>") ||
					TRIGGER_WORDS.some(str => msg.content.toLowerCase().includes(str)))
			) {
				await sendShat(
					msg.stickers.size > 0
						? { forceImage: true, ping: true, dont_save: true }
						: { msg: msg, forceImage: true, ping: true, dont_save: true }
				);
				replied = true;
			} else {
				msg.react(getRandomEmoji());
			}
		}
	});
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
};
