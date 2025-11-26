import * as Discord from "discord.js";
import { DiscordBot } from "../index.js";
import { join } from "path";
import DiscordConfig from "@/config/discord.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

const iconsPath = join(process.cwd(), "resources/discord-event-icons");

const GetParticipants = async (
	event: Discord.GuildScheduledEvent | Discord.PartialGuildScheduledEvent
) => {
	const eventUsers = await event.fetchSubscribers({ withMember: true });
	return eventUsers.map(evu => evu.member);
};

export const endEvent = async (
	event?: Discord.GuildScheduledEvent | Discord.PartialGuildScheduledEvent
) => {
	const bot = await globalThis.MetaConcord.container.getService("DiscordBot");
	const guild = bot.getGuild();
	const name = event?.name ?? "An event";
	log.info(`"${name}" ended! Removing roles...`);
	const users = (await guild?.roles.fetch(DiscordConfig.roles.event))?.members;
	users?.forEach(usr => {
		usr.roles.remove(DiscordConfig.roles.event);
	});
	const reason = name + " ended";
	await bot.setIcon(undefined, reason);
	await bot.setServerBanner(undefined, reason);
	await bot.setNickname(undefined, reason);
};

export default async (bot: DiscordBot): Promise<void> => {
	const events = [
		{
			icon: "jackbox",
			triggers: ["jackbox"],
			nicks: [
				"jacking",
				"job",
				"watercooler",
				"quip",
				"fib",
				"fibbing",
				"trivia",
				"drawing",
				"sketchy",
				"sus",
				"scribbler",
				"prompt",
			],
		},
		{
			icon: "vr",
			triggers: ["vrchat", "vr"],
			nicks: ["VR", "Virtual", "Black Cat", "Pug"],
		},
		{
			icon: "ttt",
			triggers: ["ttt"],
			nicks: ["terror", "detective", "innocent", "trouble", "clue", "banana"],
			execute: async () =>
				(await bot.container.getService("GameBridge")).servers[4]?.sendLua(
					`local request = require("gm_request") if request and not request:IsServerGamemode(3,"terrortown") then request:SwitchGamemodeAsync("terrortown",print) end`
				),
		},
		{
			icon: "ss13",
			triggers: ["ss13", "(ss13)"],
			nicks: [
				"AI",
				"Blob",
				"Borg",
				"Botanist",
				"Captain",
				"Chaplain",
				"Chemist",
				"Clown",
				"Cyborg",
				"Fried",
				"Geneticist",
				"Greytide",
				"Honk",
				"Janny",
				"Law 2",
				"Mime",
				"Nano",
				"NanoTrasen",
				"Nukie",
				"Poly",
				"Revolutionary",
				"Robust",
				"Space",
				"Supermatter",
				"Syndicate",
				"Virologist",
				"Xeno",
			],
		},
	];

	bot.discord.on("guildScheduledEventUpdate", async (old, now) => {
		const event = now;

		switch (event.status) {
			case Discord.GuildScheduledEventStatus.Active: {
				log.info(`Event "${event.name}" running! Setting roles...`); // logging because I don't trust discord
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
						if (nicks) {
							await bot.setNickname(
								nicks[(Math.random() * nicks.length) | 0],
								event.name
							);
						}
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
			case Discord.GuildScheduledEventStatus.Completed:
			case Discord.GuildScheduledEventStatus.Scheduled: {
				if (old?.status === Discord.GuildScheduledEventStatus.Active) {
					await endEvent(old);
				}
				break;
			}
		}
	});
};
