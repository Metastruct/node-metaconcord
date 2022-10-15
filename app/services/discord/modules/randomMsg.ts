import { DiscordBot } from "..";

let posting = false;

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;
	let nextMkTime = data.nextMkTime ?? Date.now();
	let lastMkMsgId = data.lastMkMsgId;
	let lastMkReplyMsgId = data.lastMkReplyMsgId;
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
		if (Date.now() > nextMkTime && !posting) {
			posting = true;
			const rng = Math.random();
			let search: string | undefined;
			if (!msg.content.startsWith("http") && rng >= 0.5) {
				const words = msg.content.split(" ");
				search = words[Math.floor(rng * words.length)];
			}
			const shat = await bot.container
				.getService("Markov")
				?.generate(search, { continuation: false });
			if (shat) {
				const reply = await msg.channel.send(shat);
				const nextTime = Math.floor(Date.now() + Math.random() * 60 * 60 * 1.5 * 1000);
				data.nextMkTime = nextMkTime = nextTime;
				data.lastMkMsgId = lastMkMsgId = msg.id;
				data.lastMkReplyMsgId = lastMkReplyMsgId = reply.id;
				await data.save();
			}
			posting = false;
		}
	});
	bot.discord.on("messageDelete", async msg => {
		if (msg.id === lastMkMsgId) {
			await (await msg.channel.messages.fetch(lastMkReplyMsgId)).delete();
		}
	});
};
