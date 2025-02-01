import { DiscordBot } from "..";
import { join } from "path";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";

const iconsPath = join(process.cwd(), "resources/discord-event-icons");

export default async (bot: DiscordBot): Promise<void> => {
	const events = [
		{
			icon: "vr",
			triggers: ["vrchat", "vr"],
			nicks: ["VR"],
		},
		{
			icon: "ttt",
			triggers: ["ttt"],
			nicks: ["terror", "detective", "innocent", "trouble", "clue", "banana", "protogen"],
			execute: async () =>
				(await bot.container.getService("GameBridge")).servers[3]?.sendLua(
					`local request = require("gm_request") if request and not request:IsServerGamemode(3,"terrortown") then request:SwitchGamemodeAsync("terrortown",print) end`
				),
		},
	];

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
		const users = (await event.guild?.roles.fetch(DiscordConfig.roles.event))?.members;
		users?.forEach(usr => {
					usr.roles.remove(DiscordConfig.roles.event);
		})
		const reason = event.name + " ended";
		await bot.setIcon(undefined, reason);
		await bot.setServerBanner(undefined, reason);
		await bot.setNickname(undefined, reason);
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
				for (const { icon, triggers, nicks, execute } of events) {
					const regex = new RegExp("\\b" + triggers.join("\\b|\\b") + "\\b");
					const match =
						regex.test(event.name.toLowerCase()) ||
						(event.description
							? regex.test(event.description?.toLocaleLowerCase())
							: false);
					if (match) {
						const path = join(iconsPath, `${icon}.png`);
						await bot.setIcon(path);
						await bot.setNickname(
							nicks[(Math.random() * nicks.length) | 0],
							event.name
						);
						if (execute) execute();
						break;
					}
				}
				const banner = event.coverImageURL({ size: 4096 });
				if (banner) {
					await bot.setServerBanner(banner, "Event banner");
				}
				break;
			}
			case Discord.GuildScheduledEventStatus.Scheduled:
			case Discord.GuildScheduledEventStatus.Completed: {
				if (old && !now.isActive()) {
					endEvent(old);
				}
				break;
			}
		}
	});
};
