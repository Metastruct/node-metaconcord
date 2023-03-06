import { DiscordBot } from "..";
import { makeSpeechBubble } from "@/utils";
import Discord from "discord.js";
import EmojiList from "unicode-emoji-json/data-ordered-emoji.json";
import bot_config from "@/config/discord.json";

// #chat and #shat constants
const ACTIVITY_CHANGE_INTERVAL = 1000 * 60 * 60 * 0.25; // interval for changing the bot status to a random message
const MSG_INTERVAL = 1000 * 60; // interval for checking messages for below trigger count, also resets activity if it was set manually or by other means
const MSG_TRIGGER_COUNT = 13; // how many msgs in above interval until a msg is posted
const MSG_CHAT_INTERVAL = 1000 * 60 * 60 * 2; // total time until a message is forced if below interval wasn't met (active chatters)
const MSG_DEAD_CHAT_REVIVAL_INTERVAL = 1000 * 60 * 60 * 1; // idle (no active chatters) time until post, can be delayed by chatting
const MSG_REPLY_INTERVAL = 1000 * 60 * 2; // limit how often people can reply to the bot and get a response
const MSG_RNG_FREQ = 0.1; // random messges that defy intervals and limits
const MSG_USE_AUTHOR_FREQ = 0.3; // use the author name instead of message
const REACTION_FREQ = 0.005; // how often to react on messages;
const SAVE_INTERVAL = 1000 * 60 * 10; // saves lastmsg/mk at that interval
const MSG_REPLY_FREQ = 0.5; // sets how often to take the previous message in the cache
const GUILD_EMOJI_RATIO = 0.5; // guild to normal emoji ratio for reactions
const MSG_CACHE_AMOUNT = 4; // how many messages to save to look up backwards
const TYPING_TRIGGER_THRESHOLD = 0.8; // at how much msgs to trigger the typing (related to MSG_TRIGGER_COUNT)

// trigger word constants
const TRIGGER_WORDS = ["metabot", "meta bot", "the bot", "metaconcord"]; // these will always count like a normal reply/ping
const MAYBE_TRIGGER_WORDS = ["metastruct", "metaconstruct", "meta", "bot"]; // not directly the bot but maybe
const MAYBE_TRIGGER_FREQ = 0.25; // frequency of triggers above

// shat constants
const STOLEN_IMAGE_FREQ = 0.025; // how often the bot will respond with an image instead of text
const IMAGE_FREQ = 0.025; // how often the bot will respond with an image from the iotd imgur album instead of text
const REPLY_FREQ = 0.25; // when to take a word from a previous discord message if provided

const ALLOWED_IMG_PROVIDERS = ["tenor", "imgur", "discordapp"];

function getWord(msg: string, fallback?: string) {
	let search: string;
	const words = msg.replace(`<@${bot_config.userId}> `, "").split(" ");
	const index = Math.floor(Math.random() * words.length);
	const isLast = index + 1 === words.length;
	if (!isLast && !fallback) {
		search = words.slice(index, index + 2).join(" ");
		fallback = words[index];
	} else {
		search = words[index];
	}
	return search;
}

export const Shat = async (
	msg?: string,
	fallback?: string,
	forceImage?: boolean,
	forceReply?: boolean,
	forceMessage?: string
): Promise<Discord.MessageCreateOptions | undefined> => {
	if (forceMessage) return { content: forceMessage };
	const rng = Math.random();
	if (rng > IMAGE_FREQ && !forceImage) {
		let search: string | undefined;
		if (msg && !msg.startsWith("http") && (rng <= REPLY_FREQ || forceReply)) {
			search = getWord(msg);
		}
		let mk = await globalThis.MetaConcord.container.getService("Markov")?.generate(search, {
			continuation: true,
		});

		if ((!mk || mk === msg) && fallback)
			mk = await globalThis.MetaConcord.container.getService("Markov")?.generate(fallback);
		if (!mk || mk === msg)
			mk = await globalThis.MetaConcord.container.getService("Markov")?.generate();

		return mk ? { content: mk.replace(`<@${bot_config.userId}> `, "") } : undefined;
	} else {
		const rng2 = Math.random();
		const images = globalThis.MetaConcord.container.getService("Motd")?.images;
		const word = msg && !msg.startsWith("http") ? getWord(msg) : undefined;
		if (images && (rng2 <= 0.5 || !word)) {
			const imgur = images[Math.floor(rng2 * images.length)];
			const result = await makeSpeechBubble(imgur.link, rng2 <= 0.5);
			return result
				? { files: [{ attachment: result, description: imgur.title }] }
				: undefined;
		} else {
			if (!word)
				return {
					content: await globalThis.MetaConcord.container
						.getService("Markov")
						?.generate(),
				}; // if for some reason images are missing
			const res = await globalThis.MetaConcord.container.getService("Tenor")?.search(word, 4);
			if (!res)
				return {
					content: await globalThis.MetaConcord.container
						.getService("Markov")
						?.generate(),
				}; // if for some reason we get no result;
			return { content: res.data.results[Math.floor(rng2 * res.data.results.length)].url };
		}
	}
};

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;
	const now = Date.now();
	let lastActivityChange = now;
	let lastAPIActivity: Discord.Activity | undefined;
	let lastSetActivity: Discord.ActivitiesOptions | undefined;
	let lastMkTime = (data.lastMkTime = data.lastMkTime ?? now);
	let lastMsgTime = (data.lastMsgTime = data.lastMsgTime ?? now);
	let lastChatTime = now;
	const lastMsgs: Discord.Message<boolean>[] = [];
	const lastImgs: string[] = [];
	let posting = false;
	let replied = false;

	const sendShat = async (
		options: {
			msg?: Discord.Message;
			forceImage?: boolean;
			forceReply?: boolean;
			forceMessage?: string;
			ping?: boolean;
			dont_save?: boolean;
		} = {}
	) => {
		posting = true;
		if (options.msg) (options.msg.channel as Discord.TextChannel).sendTyping();
		const rng = Math.random();
		const shouldUseAuthor = rng <= MSG_USE_AUTHOR_FREQ;
		const shouldStealImg = rng <= STOLEN_IMAGE_FREQ;
		const shat = await Shat(
			shouldUseAuthor ? options.msg?.author.username?.toLowerCase() : options.msg?.content,
			shouldUseAuthor ? options.msg?.content : undefined,
			options.forceImage,
			options.forceReply,
			shouldStealImg && lastImgs.length > 0
				? lastImgs[Math.floor(Math.random() * lastImgs.length)]
				: undefined
		);
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
		let emoji: Discord.EmojiIdentifierResolvable;
		if (Math.random() <= GUILD_EMOJI_RATIO) {
			emoji = bot.discord.emojis.cache.random() as Discord.EmojiIdentifierResolvable;
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

		lastSetActivity = { name: status, type: selection.type } as Discord.ActivitiesOptions;

		return lastSetActivity;
	};

	bot.discord.on("presenceUpdate", async (old, now) => {
		if (now.userId !== bot.discord.user?.id) return;
		lastAPIActivity = now.activities[0];
	});

	bot.discord.on("ready", async () => {
		bot.setActivity(undefined, await getRandomStatus());

		setInterval(async () => {
			await data.save();
		}, SAVE_INTERVAL); // save data

		setInterval(() => {
			lastImgs.splice(0, lastImgs.length);
		}, 1000 * 60 * 60 * 6);

		setInterval(async () => {
			const now = Date.now();
			if (
				lastMsgs.length > 0 &&
				lastMsgs.slice(-1)[0].author.id !== bot.discord.user?.id &&
				(now - lastChatTime > MSG_DEAD_CHAT_REVIVAL_INTERVAL ||
					lastMsgs.length - MSG_CACHE_AMOUNT >= MSG_TRIGGER_COUNT ||
					now - lastMsgTime > MSG_CHAT_INTERVAL) &&
				!posting
			) {
				await sendShat({
					dont_save: true,
					msg: Math.random() <= MSG_REPLY_FREQ ? lastMsgs.slice(-1)[0] : undefined,
				});
				data.lastMsgTime = lastMsgTime = now;
				bot.setActivity(undefined, await getRandomStatus());
			}
			if (now - lastActivityChange > ACTIVITY_CHANGE_INTERVAL) {
				bot.setActivity(undefined, await getRandomStatus());
				lastActivityChange = now;
			} else if (lastSetActivity?.name !== lastAPIActivity?.name) {
				bot.setActivity(undefined, lastSetActivity);
			}
			lastMsgs.splice(0, lastMsgs.length - MSG_CACHE_AMOUNT); // delete lastmsg cache except the last two messages used for lookups
		}, MSG_INTERVAL);
	});

	bot.discord.on("messageDelete", async msg => {
		if (msg.channelId !== bot.config.chatChannelId) return;
		const idx = lastMsgs.indexOf(msg as Discord.Message);
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
				TRIGGER_WORDS.some(str =>
					msg.content.toLowerCase().match(new RegExp(`/\s?${str}\s/`))
				))
		) {
			setTimeout(async () => msg.react(getRandomEmoji()), 1000 * 10);
		}

		// #shitpost channel
		if (
			msg.author.id !== id &&
			(msg.mentions.users.first()?.id === id ||
				TRIGGER_WORDS.some(str =>
					msg.content.toLowerCase().match(new RegExp(`/\s?${str}\s/`))
				)) &&
			bot.config.allowedShitpostingChannels.includes(msg.channelId)
		) {
			(msg.channel as Discord.TextChannel).sendTyping();
			const shat = await Shat(msg.content);
			if (shat) await msg.reply(shat);
		}

		// #chat channel
		if (bot.config.chatChannelId === msg.channelId) {
			lastChatTime = Date.now();
			lastMsgs.push(msg);
			if (
				lastMsgs.length - MSG_CACHE_AMOUNT < MSG_TRIGGER_COUNT &&
				(lastMsgs.length - MSG_CACHE_AMOUNT) / MSG_TRIGGER_COUNT >= TYPING_TRIGGER_THRESHOLD
			) {
				(msg.channel as Discord.TextChannel).sendTyping();
			}
		}
		// https?:\/\/(?:\w+)?.?(discordapp).\w+\/
		if (msg.content.startsWith("http") && msg.author.id !== id) {
			if (
				msg.content.match(
					new RegExp(
						`^https?://(?:\\w+)?.?(${ALLOWED_IMG_PROVIDERS.join(
							"|"
						)}).\\w+/[^\\s]+[^.mov|.mp4|.webm]$`
					)
				)
			) {
				lastImgs.push(msg.content);
			}
		}

		if (
			bot.config.chatChannelId === msg.channelId &&
			msg.author.id !== id &&
			((msg.mentions.users.first()?.id === id && msg.content !== `<@${id}>`) ||
				TRIGGER_WORDS.some(str => msg.content.toLowerCase().includes(str)) ||
				(Math.random() <= MAYBE_TRIGGER_FREQ &&
					MAYBE_TRIGGER_WORDS.some(str =>
						msg.content.toLowerCase().match(new RegExp(`/\s?${str}\s/`))
					)))
		) {
			const itsPostingTime = Date.now() - lastMkTime > MSG_REPLY_INTERVAL;
			if (
				(itsPostingTime || Math.random() <= MSG_RNG_FREQ) &&
				!posting &&
				lastMsgs.length >= MSG_CACHE_AMOUNT &&
				lastMsgs.slice(-4)[0].author.id !== id
			) {
				await sendShat(
					msg.stickers.size > 0
						? { forceImage: true, forceReply: true }
						: { msg: msg, forceReply: true }
				);
				replied = false;
				data.lastMsgTime = lastMsgTime = Date.now();
			} else if (!itsPostingTime && (!replied || Math.random() <= MSG_RNG_FREQ) && !posting) {
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
};
