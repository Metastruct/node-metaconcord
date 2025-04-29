import { DiscordBot } from "../index.js";

export default async (bot: DiscordBot): Promise<void> => {
	const data = await bot.container.getService("Data");
	const channels = data.tempVoiceChannels;

	bot.discord.on("voiceStateUpdate", async oldState => {
		if (oldState.channelId && oldState.channel) {
			const channel = oldState.channel;
			let changes = false;
			for (const [ownerId, data] of Object.entries(channels)) {
				if (data.channelId === channel.id && channel.members.size === 0) {
					await channel.delete("time expired or channel is empty");
					delete channels[ownerId];
					changes = true;
				}
			}
			if (changes) data.save();
		}
	});

	bot.discord.on("ready", async () => {
		if (!channels) return;
		const guildChannels = bot.getGuild()?.channels;
		if (guildChannels) {
			let changes = false;
			for (const [ownerId, data] of Object.entries(channels)) {
				if (!guildChannels.cache.has(data.channelId)) {
					delete channels[ownerId];
					changes = true;
				}
			}
			if (changes) data.save();
		}
	});
};
