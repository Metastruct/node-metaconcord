import { DiscordBot } from "..";
import { join } from "path";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";
import dayjs from "dayjs";

const events = [
	{
		icon: "vr",
		eventData: {
			entityType: Discord.GuildScheduledEventEntityType.Voice,
			privacyLevel: Discord.GuildScheduledEventPrivacyLevel.GuildOnly,
			entityMetadata: { location: "VRChat" },
			name: "VRChat [Automated Event]",
			description:
				"Wanna join us in VR? Sign up so we know. Discussion in <#1009704968070107148>\n\nAlso checkout our Group at https://vrchat.com/home/group/grp_caeaacf4-a8a7-4e7d-8b66-46094732f85b",
			reason: "Automated Event",
		} as Discord.GuildScheduledEventCreateOptions,
		triggers: ["vrchat", "vr"],
		notificationChannel: DiscordConfig.threads.VR,
	},
];
const iconsPath = join(process.cwd(), "resources/discord-event-icons");

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;

	const GetParticipants = async (event: Discord.GuildScheduledEvent) => {
		const eventUsers = await event.fetchSubscribers({ withMember: true });
		return eventUsers.map(evu => evu.member);
	};

	const checkEvents = async () => {
		const guild = bot.getGuild();
		if (!guild) return;
		const eventList = await guild.scheduledEvents.fetch();
		for (const { eventData, notificationChannel } of events) {
			const existingEvent = eventList.find(event => event.name === eventData.name);
			if (existingEvent) return;

			// todo: figure out how to properly schedule this for multiple events, maybe just use cron afterall??
			let nextDate = dayjs().day(6).hour(20).minute(0).second(0);
			if (nextDate.isBefore(dayjs())) nextDate = nextDate.add(7, "days");

			const event = await guild.scheduledEvents.create({
				...eventData,
				scheduledStartTime: nextDate.toDate(),
			});

			if (notificationChannel)
				(guild.channels.cache.get(notificationChannel) as Discord.TextChannel).send(
					event.url
				);
		}
	};

	bot.discord.on("ready", async () => {
		await checkEvents();
	});

	bot.discord.on("guildScheduledEventDelete", async () => {
		await checkEvents();
	});

	bot.discord.on("guildScheduledEventUpdate", async (_, now) => {
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
					let match = false;
					for (const trigger of triggers) {
						if (event.name.toLowerCase().match(new RegExp(`${trigger}\\s`)))
							match = true;
					}
					if (match) {
						await event.guild?.setIcon(join(iconsPath, `${icon}.png`));
						break;
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
				await event.guild?.setIcon(data.lastDiscordGuildIcon);
				checkEvents();
				break;
			}
		}
	});
};
