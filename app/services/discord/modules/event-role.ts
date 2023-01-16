import { DiscordBot } from "..";
import Config from "@/config/discord-extras.json";
import Discord from "discord.js";

export default (bot: DiscordBot): void => {
	const GetParticipants = async (event: Discord.GuildScheduledEvent) => {
		const eventUsers = await event.fetchSubscribers({ withMember: true });
		return eventUsers.map(evu => evu.member);
	};

	bot.discord.on("guildScheduledEventUpdate", async (was, now) => {
		const event = now;
		if (
			event.channelId !== Config.channels.eventStage &&
			event.channelId !== Config.channels.eventVoice
		)
			return;
		switch (event.status) {
			case Discord.GuildScheduledEventStatus.Active: {
				console.log(`Event "${event.name}" running! Setting roles...`); // logging because I don't trust discord
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (!usr.roles.cache.some(role => role.id === Config.roles.event))
						usr.roles.add(Config.roles.event);
				});
				break;
			}
			case Discord.GuildScheduledEventStatus.Canceled:
			case Discord.GuildScheduledEventStatus.Completed: {
				console.log(`Event "${event.name}" ended! Removing roles...`);
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (usr.roles.cache.some(role => role.id === Config.roles.event))
						usr.roles.remove(Config.roles.event);
				});
				break;
			}
		}
	});
};
