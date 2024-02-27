import { DiscordBot } from "..";
import { join } from "path";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";

const events = [
	{
		icon: "vr",
		triggers: ["vrchat", "vr"],
	},
	{
		icon: "ttt",
		triggers: ["ttt"],
	},
];
const iconsPath = join(process.cwd(), "resources/discord-event-icons");

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;

	const GetParticipants = async (
		event: Discord.GuildScheduledEvent | Discord.PartialGuildScheduledEvent
	) => {
		const eventUsers = await event.fetchSubscribers({ withMember: true });
		return eventUsers.map(evu => evu.member);
	};

	const endEvent = async (
		event: Discord.GuildScheduledEvent | Discord.PartialGuildScheduledEvent
	) => {
		console.log(`Event "${event.name}" ended! Removing roles...`);
		const users = await GetParticipants(event);
		if (users.length === 0) {
			console.error("[discord-events] wtf??? event has no users? can't remove roles");
			return;
		}
		users.forEach(usr => {
			if (usr.roles.cache.some(role => role.id === DiscordConfig.roles.event))
				usr.roles.remove(DiscordConfig.roles.event);
		});
		await event.guild?.setIcon(data.lastDiscordGuildIcon);
	};

	bot.discord.on("guildScheduledEventUpdate", async (old, now) => {
		const event = now;

		switch (event.status) {
			case Discord.GuildScheduledEventStatus.Active: {
				console.log(`Event "${event.name}" running! Setting roles...`); // logging because I don't trust discord
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (!usr.roles.cache.some(role => role.id === DiscordConfig.roles.event))
						usr.roles.add(DiscordConfig.roles.event);
				});
				for (const { icon, triggers } of events) {
					const regex = new RegExp("\\b" + triggers.join("\\b|\\b") + "\\b");
					const match =
						regex.test(event.name.toLowerCase()) ||
						(event.description
							? regex.test(event.description?.toLocaleLowerCase())
							: false);
					if (match) {
						await event.guild?.setIcon(join(iconsPath, `${icon}.png`));
						break;
					}
				}
				break;
			}
			case Discord.GuildScheduledEventStatus.Scheduled:
			case Discord.GuildScheduledEventStatus.Completed: {
				if (old && !old.isActive()) {
					endEvent(old);
				}
				break;
			}
		}
	});
};
