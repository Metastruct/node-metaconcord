import { DiscordBot } from "..";
import { join } from "path";
import { scheduleJob } from "node-schedule";
import { stat } from "fs/promises";
import dayjs from "dayjs";

const events = [
	{
		icon: "summer",
		range: ["01/06", "07/09"],
	},
	{
		icon: "halloween",
		range: ["01/10", "07/11"],
	},
	{
		icon: "christmas",
		range: ["01/12", "26/12"],
	},
	{
		icon: "new-years-eve",
		range: ["27/12", "31/12"],
	},
	{
		icon: "new-years-eve",
		range: ["01/01", "07/01"], // We do a little cheating
	},
];
const iconsPath = join(require.main.path, "resources/discord-guild-icons");
const defaultIconPath = join(iconsPath, "default.png");

const fileExists = async filePath =>
	await stat(filePath)
		.then(stats => stats.isFile())
		.catch(() => false);

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");

	bot.discord.on("ready", async () => {
		const guild = await bot.discord.guilds.fetch(bot.config.guildId);

		const changeIcon = async (filePath, eventName) => {
			if (data.lastDiscordGuildIcon === eventName) return;

			try {
				await guild.setIcon(
					filePath,
					eventName !== "None"
						? `It's ${eventName}!`
						: "Back to regularly scheduled activities."
				);

				data.lastDiscordGuildIcon = eventName;
				await data.save();

				console.log("Changed server icon successfully!");
			} catch (err) {
				console.error(err);
				throw new Error(
					"Can't change guild icon: the bot is likely missing permissions to do so."
				);
			}
		};

		const checkDate = async () => {
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
					let filePath = join(iconsPath, `${icon}.gif`);
					if (guild.premiumTier === "NONE" || !(await fileExists(filePath))) {
						filePath = join(iconsPath, `${icon}.png`);
					}
					if (!(await fileExists(filePath))) {
						filePath = defaultIconPath;
					}

					return {
						filePath,
						eventName: icon
							.split("-")
							.map(str => str.charAt(0).toUpperCase() + str.slice(1))
							.join(" "),
					};
				}
			}

			return { filePath: defaultIconPath, eventName: "None" };
		};

		const doIt = async () => {
			const { filePath, eventName } = await checkDate();
			changeIcon(filePath, eventName);
		};

		scheduleJob("0 0 * * *", doIt);
	});
};
