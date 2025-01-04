import { DiscordBot } from "..";
import { GuildPremiumTier } from "discord.js";
import { PathLike } from "fs";
import { join } from "path";
import { scheduleJob } from "node-schedule";
import { stat } from "fs/promises";
import dayjs from "dayjs";

export const events = [
	{
		icon: "haaugh",
		range: ["27/03", "28/03"],
	},
	{
		icon: "summer",
		range: ["01/06", "01/09"],
	},
	{
		icon: "oktober",
		range: ["16/09", "03/10"],
	},
	{
		icon: "halloween",
		range: ["03/10", "01/11"],
	},
	{
		icon: "christmas",
		range: ["01/12", "26/12"],
	},
	{
		icon: "new-year",
		range: ["30/12", "31/12"],
	},
	{
		icon: "new-year",
		range: ["01/01", "03/01"], // We do a little cheating
	},
];
const iconsPath = join(process.cwd(), "resources/discord-guild-icons");
const defaultIconPath = join(iconsPath, "default.png");

const fileExists = async (filePath: PathLike) =>
	await stat(filePath)
		.then(stats => stats.isFile())
		.catch(() => false);

export default async (bot: DiscordBot): Promise<void> => {
	bot.discord.on("ready", async () => {
		const guild = bot.getGuild();
		if (!guild) return;
		const data = await bot.container.getService("Data");

		const changeIcon = async (filePath: string, eventName: string) => {
			const eventChange = data.lastDiscordGuildEvent !== eventName;
			const guildEvents = await guild.scheduledEvents.fetch();
			if (!eventChange) return;

			if (eventChange && !guildEvents.find(ev => ev.isActive())) {
				try {
					await bot.setIcon(
						filePath,
						eventName !== "None"
							? `It's ${eventName}!`
							: "Back to regularly scheduled activities."
					);
					data.lastDiscordGuildEvent = eventName;
					await data.save();
				} catch (err) {
					console.error(err);
					return;
				}
			}
		};

		const checkDate = async () => {
			let filePath = defaultIconPath;
			let eventName = "None";

			for (const { icon, range } of events) {
				const [start, end] = range;
				const [startDay, startMonth] = start.split("/").map(n => +n);
				const [endDay, endMonth] = end.split("/").map(n => +n);

				const now = dayjs();
				const day = now.date();
				const month = now.month() + 1;

				const inMonth = month >= startMonth && month <= endMonth;
				const correctDay =
					startDay <= (month > startMonth ? startDay : day) &&
					endDay >= (month < endMonth ? endDay : day);

				if (inMonth && correctDay) {
					filePath = join(iconsPath, `${icon}.gif`);
					if (
						guild.premiumTier === GuildPremiumTier.None ||
						!(await fileExists(filePath))
					) {
						filePath = join(iconsPath, `${icon}.png`);
					}
					if (!(await fileExists(filePath))) {
						filePath = defaultIconPath;
					}
					eventName = icon
						.split("-")
						.map(str => str.charAt(0).toUpperCase() + str.slice(1))
						.join(" ");
					break;
				}
			}

			return { filePath: filePath, eventName };
		};

		const doIt = async () => {
			const { filePath, eventName } = await checkDate();
			changeIcon(filePath, eventName);
		};

		scheduleJob("0 0 * * *", doIt);
		doIt();
	});
};
