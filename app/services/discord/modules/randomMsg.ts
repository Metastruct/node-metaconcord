import { DiscordBot } from "..";

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;
	let nextMkTime = data.nextMkTime ?? Date.now();
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
		if (Date.now() > nextMkTime) {
			const reply = await bot.container.getService("Markov")?.generate();
			if (reply) {
				await msg.channel.send(reply);
				const nextTime = Math.floor(Date.now() + Math.random() * 60 * 60 * 3 * 1000);
				data.nextMkTime = nextTime;
				nextMkTime = nextTime;
				await data.save();
			}
		}
	});
};
