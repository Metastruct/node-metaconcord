import { DiscordBot } from "..";
import { IGenerateOptions } from "../../Markov";
import { makeSpeechBubble } from "@/utils";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";
import EmojiList from "unicode-emoji-json/data-ordered-emoji.json";

// #chat and #shat constants
const ACTIVITY_CHANGE_INTERVAL = 1000 * 60 * 60 * 0.25; // interval for changing the bot status to a random message
const MSG_INTERVAL = 1000 * 60; // interval for checking messages for below trigger count, also resets activity if it was set manually or by other means
const MSG_REPLY_INTERVAL = 1000 * 60 * 60 * 0.25; // interval when to allow replying to messages
const MSG_TRIGGER_COUNT = 10; // how many msgs in above interval until a msg is posted
const MSG_CHAT_INTERVAL = 1000 * 60 * 60 * 2; // total time until a message is forced if below interval wasn't met (active chatters)
const MSG_DEAD_CHAT_REVIVAL_INTERVAL = 1000 * 60 * 60 * 0.75; // idle (no active chatters) time until post, can be delayed by chatting
const MSG_USE_AUTHOR_FREQ = 0.3; // use the author name instead of message
const MSG_USE_HUGGINGFACE_FREQ = 0.5; // use hugging face to reply instead of markov
const MSG_REPLY_REACTION_FREQ = 0.3;
const MSG_REPLY_REACTION_CLEAR_INTERVAL = 1000 * 60 * 60;
const REACTION_FREQ = 0.005; // how often to react on messages;
const SAVE_INTERVAL = 1000 * 60 * 60 * 0.25; // saves lastmsg/mk at that interval
const MSG_REPLY_FREQ = 0.5; // sets how often to take the previous message in the cache
const GUILD_EMOJI_RATIO = 0.5; // guild to normal emoji ratio for reactions
const COMMON_EMOJI_RATIO = 0.7;
const TYPING_TRIGGER_THRESHOLD = 0.9; // at how much msgs to trigger the typing (related to MSG_TRIGGER_COUNT)

// trigger word constants
const TRIGGER_WORDS = ["metabot", "meta bot", "the bot", "metaconcord"]; // these will always count like a normal reply/ping
const MAYBE_TRIGGER_WORDS = ["metastruct", "metaconstruct", "meta", "bot"]; // not directly the bot but maybe
const MAYBE_TRIGGER_FREQ = 0.4; // frequency of triggers above

// shat constants
const TENOR_IMAGE_FREQ = 0.1; // how often the image will be taken from tenor instead of local cache
const DISCORD_IMAGE_FREQ = 0.15; // how often the bot will respond with an image instead of text
const EMOJI_REPLY_FREQ = 0.2; // how often to reply with just an emoji
const STICKER_FREQ = 0.02; // how often to reply with just a sticker
const REPLY_FREQ = 0.5; // how often to when to take a word from a previous message if provided

const ALLOWED_IMG_PROVIDERS = ["tenor", "imgur", "discordapp", "tumblr"];

const IGNORE_LIST = ["437294613976449024"];

function getWord(msg?: string) {
	if (!msg) return undefined;
	let search: string;
	const words = msg.replaceAll(`<@${DiscordConfig.bot.userId}> `, "").split(" ");
	const index = (Math.random() * words.length) | 0;
	const isLast = index + 1 === words.length;
	if (!isLast) {
		search = words.slice(index, index + 2).join(" ");
	} else {
		search = words[index];
	}
	return search;
}

const DefaultMarkovConfig: IGenerateOptions = {
	depth: ((Math.random() * 2) | 0) + 3, // random number from 3 to 4
};

export const Shat = async (options?: {
	msg?: string;
	fallback?: string;
	forceImage?: boolean;
	forceReply?: boolean;
	forceMessage?: string | Discord.MessageCreateOptions;
	forceHuggingface?: boolean;
}): Promise<Discord.MessageCreateOptions | undefined> => {
	if (options?.forceMessage)
		return typeof options.forceMessage === "string"
			? { content: options.forceMessage }
			: options.forceMessage;

	const rng = Math.random();

	if (rng > TENOR_IMAGE_FREQ && !options?.forceImage) {
		const message = options?.msg?.replaceAll(`<@${DiscordConfig.bot.userId}> `, "");
		let search: string | undefined;
		let shat: string | undefined;

		if (message && !message.startsWith("http")) {
			if (rng <= REPLY_FREQ || options?.forceReply) search = getWord(message);
			if (options?.forceHuggingface) {
				const response = await globalThis.MetaConcord.container
					.getService("Huggingface")
					?.textGeneration(message, 100);
				shat = response.generated_text;
			}
		}

		if (!shat || shat === options?.msg)
			shat = await globalThis.MetaConcord.container
				.getService("Markov")
				?.generate(getWord(search ?? options?.fallback), DefaultMarkovConfig);

		return shat ? { content: shat } : undefined;
	} else {
		const images = globalThis.MetaConcord.container.getService("Motd")?.images;
		let word =
			options?.msg && !options.msg.startsWith("http") ? getWord(options.msg) : undefined;

		if (!word)
			word = getWord(
				await globalThis.MetaConcord.container
					.getService("Markov")
					?.generate(undefined, DefaultMarkovConfig)
			);

		if (images.length !== 0 && (Math.random() <= 0.5 || !word)) {
			const imgur = images[(Math.random() * images.length) | 0];
			const result = await makeSpeechBubble(imgur.link, Math.random() <= 0.5);
			return result
				? { files: [{ attachment: result, description: imgur.title }] }
				: undefined;
		} else {
			const res = await globalThis.MetaConcord.container.getService("Tenor")?.search(word, 4);
			if (!res)
				return {
					content: await globalThis.MetaConcord.container
						.getService("Markov")
						?.generate(undefined, DefaultMarkovConfig),
				}; // if for some reason we get no result;
			return {
				content: res.data.results[(Math.random() * res.data.results.length) | 0].url,
			};
		}
	}
};

const COMMON_EMOJIS = [
	"❓",
	"🐴",
	"👀",
	"👍",
	"👎",
	"💀",
	"💋",
	"💦",
	"🔥",
	"🤓",
	"🤔",
	"🤝",
	"🤡",
	"🤣",
	"🤨",
	"🤩",
	"🥹",
	"🥺",
	"😂",
	"😔",
	"😠",
	"😭",
	"😵‍💫",
	"😹",
	"🙂",
	"🙄",
	"🙏",
];

export default async (bot: DiscordBot) => {
	const data = bot.container.getService("Data");
	const db = await bot.container.getService("SQL")?.getLocalDatabase();
	if (!data || !db) return;
	db.exec("CREATE TABLE IF NOT EXISTS media_urls (url VARCHAR(255) NOT NULL UNIQUE);");
	const now = Date.now();
	let lastActivityChange = now;
	let lastAPIActivity: Discord.Activity | undefined;
	let lastSetActivity: Discord.ActivitiesOptions | undefined;
	let lastMsgTime = (data.lastMsgTime = data.lastMsgTime ?? now);
	let lastChatTime = now;
	let lastReactionUserId: string | undefined;
	const lastMsgs: Discord.Message<boolean>[] = [];
	const lastRespondedReactionMsgs: string[] = [];
	let posting = false;
	let replied = false;

	const getRandomEmoji = () => {
		let emoji: Discord.EmojiIdentifierResolvable;
		if (Math.random() <= GUILD_EMOJI_RATIO) {
			emoji = bot.discord.emojis.cache.random() as Discord.EmojiIdentifierResolvable;
		} else {
			emoji =
				Math.random() <= COMMON_EMOJI_RATIO
					? COMMON_EMOJIS[(Math.random() * COMMON_EMOJIS.length) | 0]
					: EmojiList[(Math.random() * EmojiList.length) | 0];
		}
		return emoji;
	};

	const sendShat = async (
		options: {
			msg?: Discord.Message;
			originalMsg?: Discord.Message;
			forceImage?: boolean;
			forceReply?: boolean;
			forceMessage?: string;
			ping?: boolean;
		} = {}
	) => {
		posting = true;
		if (options.msg) (options.msg.channel as Discord.TextChannel).sendTyping();
		const rng = Math.random();
		const shouldUseHuggingface = rng <= MSG_USE_HUGGINGFACE_FREQ;
		const shouldUseAuthor = rng <= MSG_USE_AUTHOR_FREQ;
		const shouldSendImg = rng <= DISCORD_IMAGE_FREQ;
		const shouldSendSticker = rng <= STICKER_FREQ;
		const shouldSendEmoji = rng <= EMOJI_REPLY_FREQ;
		const shat = await Shat({
			msg: shouldUseHuggingface
				? `${
						options.msg?.author.globalName ?? options.msg?.author.username ?? "someone"
				  }: ${options.originalMsg ? `@${options.originalMsg.author.username}` : ""} ${
						options.msg?.content
				  }`
				: shouldUseAuthor
				? options.msg?.author.globalName?.toLowerCase() ??
				  options.msg?.author.username?.toLowerCase()
				: options.msg?.content,
			fallback: shouldUseAuthor ? options.msg?.content : undefined,
			forceImage: options.forceImage,
			forceReply: options.forceReply,
			forceMessage: shouldSendSticker
				? ({
						stickers: [bot.getGuild()?.stickers.cache.random()],
				  } as Discord.MessageCreateOptions)
				: shouldSendImg
				? (
						await db.get<any>("SELECT url FROM media_urls ORDER BY RANDOM() LIMIT 1")
				  ).url
				: shouldSendEmoji
				? getRandomEmoji().toString()
				: undefined,
			forceHuggingface: shouldUseHuggingface,
		});
		if (shat) {
			if (options.msg) {
				await options.msg
					.reply({
						...shat,
						allowedMentions: options.ping
							? { repliedUser: true }
							: { repliedUser: false },
					})
					.catch(e => {
						console.error(e, shat, options);
					});
			} else {
				await bot
					.getTextChannel(bot.config.channels.chat)
					?.send(shat)
					.catch(e => {
						console.error(e, shat, options);
					});
			}
		}
		posting = false;
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

		const selection = validActivities[(Math.random() * validActivities.length) | 0];

		let status = "crashing the source engine";

		const sentence = await bot.container
			.getService("Markov")
			?.generate(selection.ctx[(Math.random() * selection.ctx.length) | 0], {
				...DefaultMarkovConfig,
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

	bot.discord.once("ready", async client => {
		bot.setActivity(undefined, await getRandomStatus());

		setInterval(async () => {
			await data.save();
		}, SAVE_INTERVAL); // save data

		setInterval(async () => {
			lastRespondedReactionMsgs.splice(0, lastRespondedReactionMsgs.length - 1);
		}, MSG_REPLY_REACTION_CLEAR_INTERVAL);

		setInterval(async () => {
			if (!client.isReady()) return;
			const now = Date.now();
			if (now - lastMsgTime >= MSG_REPLY_INTERVAL) {
				replied = false;
			}
			if (
				((lastMsgs.length > 0 && lastMsgs.slice(-1)[0].author.id) ||
					(await bot.getTextChannel(bot.config.channels.chat)?.lastMessage?.fetch())
						?.author.id) !== client.user.id &&
				(now - lastChatTime > MSG_DEAD_CHAT_REVIVAL_INTERVAL ||
					lastMsgs.length >= MSG_TRIGGER_COUNT ||
					now - lastMsgTime > MSG_CHAT_INTERVAL) &&
				!posting
			) {
				await sendShat({
					msg: Math.random() <= MSG_REPLY_FREQ ? lastMsgs.slice(-1)[0] : undefined,
				});
				data.lastMsgTime = lastMsgTime = now;
				replied = false;
				bot.setActivity(undefined, await getRandomStatus());
			}
			if (now - lastActivityChange > ACTIVITY_CHANGE_INTERVAL) {
				bot.setActivity(undefined, await getRandomStatus());
				lastActivityChange = now;
			} else if (lastSetActivity?.name !== lastAPIActivity?.name) {
				bot.setActivity(undefined, lastSetActivity);
			}
			lastMsgs.splice(0, lastMsgs.length - 1); // delete lastmsg cache
		}, MSG_INTERVAL);
	});

	bot.discord.on("messageDelete", async msg => {
		if (msg.channelId !== bot.config.channels.chat) return;
		const idx = lastMsgs.indexOf(msg as Discord.Message);
		if (idx !== -1) lastMsgs.splice(idx, 1);
	});

	bot.discord.on("messageReactionAdd", async (reaction, user) => {
		if (
			!bot.config.bot.allowedShitpostingChannels.includes(reaction.message.channelId) ||
			reaction.message.author?.id !== bot.discord.user?.id ||
			lastRespondedReactionMsgs[reaction.message.id]
		)
			return;

		if (
			user.id !== lastReactionUserId &&
			Math.random() <= (reaction.emoji.name === "h_" ? 0.025 : MSG_REPLY_REACTION_FREQ)
		) {
			const mk = await bot.container
				.getService("Markov")
				?.generate(reaction.emoji.toString(), DefaultMarkovConfig);
			if (mk) {
				lastReactionUserId = user.id;
				lastRespondedReactionMsgs.push(reaction.message.id);
				await reaction.message.channel.send(`${user.mention} ` + mk).catch();
			}
		}
	});

	bot.discord.on("messageCreate", async msg => {
		const id = bot.discord.user?.id;
		if (!id) return;

		if (IGNORE_LIST.includes(msg.author.id)) return;

		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}

		const rng = Math.random();

		// triggers
		const isTriggerWord = TRIGGER_WORDS.some(str =>
			msg.content.toLowerCase().match(new RegExp(`\\b${str}\\b`))
		);
		const isMaybeTriggerWord =
			rng <= MAYBE_TRIGGER_FREQ &&
			MAYBE_TRIGGER_WORDS.some(str =>
				msg.content.toLowerCase().match(new RegExp(`\\b${str}\\b`))
			);
		const isChatChannel = bot.config.channels.chat === msg.channelId;
		const isBot = msg.author.id === id;
		const isMention = msg.mentions.users.first()?.id === id;
		const isAllowedChannel = bot.config.bot.allowedShitpostingChannels.includes(msg.channelId);
		const isHidden = msg.guild
			? !(msg.channel as Discord.GuildChannel)
					.permissionsFor(msg.guild.roles.everyone)
					.has("ViewChannel")
			: true;

		// Message Reactions
		if (
			!isBot &&
			(rng <= REACTION_FREQ ||
				(!isAllowedChannel && (isTriggerWord || isMaybeTriggerWord || isMention)))
		) {
			setTimeout(async () => msg.react(getRandomEmoji()).catch(), 1000 * 10);
		}

		// Chatting
		if (
			isAllowedChannel &&
			!isBot &&
			((isMention && msg.content !== `<@${id}>`) || isTriggerWord || isMaybeTriggerWord)
		) {
			if (!posting && (!replied || !isChatChannel)) {
				await sendShat(
					msg.stickers.size > 0
						? { forceImage: true, ping: true }
						: {
								msg: msg,
								originalMsg: msg.reference ? await msg.fetchReference() : undefined,
								ping: true,
						  }
				).catch(console.error);
				if (isChatChannel) replied = true;
			} else {
				msg.react(getRandomEmoji()).catch();
			}
		}

		// lastMessage collector
		if (isChatChannel) {
			lastChatTime = Date.now();
			lastMsgs.push(msg);
			if (
				lastMsgs.length < MSG_TRIGGER_COUNT &&
				lastMsgs.length / MSG_TRIGGER_COUNT >= TYPING_TRIGGER_THRESHOLD
			) {
				(msg.channel as Discord.TextChannel).sendTyping();
			}
		}

		// image collector
		if (msg.content.startsWith("http") && !isBot && !isHidden) {
			if (
				msg.content.match(
					new RegExp(
						`^https?://(?:(?:\\w+)?\\.?)+(?:${ALLOWED_IMG_PROVIDERS.join(
							"|"
						)})\\.(?:com|io)/[^\\s]+$`
					)
				)
			) {
				db.run("INSERT INTO media_urls VALUES($url) ON CONFLICT DO NOTHING", {
					$url: msg.content,
				});
			}
		}
	});
};
