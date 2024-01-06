import { DiscordBot } from "..";
import { join } from "path";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";

const events = [
	{
		icon: "vr",
		triggers: ["vrchat", "vr"],
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
					const match = new RegExp("\\b" + triggers.join("\\b|\\b") + "\\b").test(
						event.name.toLowerCase()
					);
					if (match) {
						await event.guild?.setIcon(join(iconsPath, `${icon}.png`));
						break;
					}
				}
				break;
			}
			case Discord.GuildScheduledEventStatus.Completed: {
				console.log(`Event "${event.name}" ended! Removing roles...`);
				const users = await GetParticipants(event);
				users.forEach(usr => {
					if (usr.roles.cache.some(role => role.id === DiscordConfig.roles.event))
						usr.roles.remove(DiscordConfig.roles.event);
				});
				await event.guild?.setIcon(data.lastDiscordGuildIcon);
				break;
			}
		}
	});
};
