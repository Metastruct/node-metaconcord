import { DiscordBot } from "..";
import { Message } from "discord.js";
import { Shat } from "./shitposting";

const MSG_IDLE_INTERVAL = 1000 * 60 * 60 * 0.5; // 30 min
const MSG_INTERVAL = 1000 * 60 * 60 * 0.25; // 15 min

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
					allowedMentions: ping ? { parse: ["users"] } : { parse: [] },
				});
			} else {
				await (await bot.getTextChannel(bot.config.chatChannelId))?.send(shat);
			}

			data.lastMkTime = lastMkTime = Date.now();
			await data.save();
		}
		posting = false;
	};

	setInterval(async () => {
		if (Date.now() - lastMkTime > MSG_IDLE_INTERVAL && !posting) {
			await sendShat();
		}
	}, 1000 * 60 * 15);

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
		if (its_posting_time && !posting) {
			await sendShat(msg);
			replied = false;
		} else if (
			!its_posting_time &&
			!replied &&
			!posting &&
			msg.mentions.users.first()?.id === bot.discord.user?.id
		) {
			await sendShat(msg, true, true);
			replied = true;
		}
	});
};
