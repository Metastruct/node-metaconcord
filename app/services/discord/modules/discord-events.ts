import { DiscordBot } from "..";
import { join } from "path";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";

const events = [
	{
		icon: "vr",
		triggers: ["vrchat"],
	},
];
const iconsPath = join(process.cwd(), "resources/discord-event-icons");

export default (bot: DiscordBot): void => {
	const GetParticipants = async (event: Discord.GuildScheduledEvent) => {
		const eventUsers = await event.fetchSubscribers({ withMember: true });
		return eventUsers.map(evu => evu.member);
	};

	let oldIcon: string | null;

	bot.discord.on("guildScheduledEventUpdate", async (was, now) => {
		const event = now;
		if (event.channelId !== DiscordConfig.channels.eventStage) return;
		switch (event.status) {
			case Discord.GuildScheduledEventStatus.Active: {
				console.log(`Event "${event.name}" running! Setting roles...`); // logging because I don't trust discord
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (!usr.roles.cache.some(role => role.id === DiscordConfig.roles.event))
						usr.roles.add(DiscordConfig.roles.event);
				});
				for (const { icon, triggers } of events) {
					if (triggers.includes(event.name.toLowerCase())) {
						const currentIcon = event.guild?.iconURL();
						oldIcon = currentIcon ? currentIcon : "wtf";
						await event.guild?.setIcon(join(iconsPath, `${icon}.png`));
					}
				}
				break;
			}
			case Discord.GuildScheduledEventStatus.Canceled:
			case Discord.GuildScheduledEventStatus.Completed: {
				console.log(`Event "${event.name}" ended! Removing roles...`);
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (usr.roles.cache.some(role => role.id === DiscordConfig.roles.event))
						usr.roles.remove(DiscordConfig.roles.event);
				});
				if (oldIcon) {
					await event.guild?.setIcon(oldIcon);
					oldIcon = null;
				}
				break;
			}
		}
	});
};
