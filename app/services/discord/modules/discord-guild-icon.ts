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

const filter = [
	"again",
	"also",
	"an",
	"and",
	"but",
	"by",
	"come",
	"despite",
	"did",
	"do",
	"done",
	"else",
	"for",
	"has",
	"hasn't",
	"hasnt",
	"have",
	"i'm",
	"if",
	"im",
	"in",
	"instead",
	"is",
	"it's",
	"it",
	"its",
	"like",
	"literally",
	"me",
	"myself",
	"nor",
	"of",
	"rather",
	"so",
	"than",
	"then",
	"there",
	"this",
	"to",
	"was",
	"while",
	"with",
	"yet",
];

export default (bot: DiscordBot): void => {
	const data = bot.container.getService("Data");
	if (!data) return;

	bot.discord.on("ready", async () => {
		const guild = bot.getGuild();
		if (!guild) return;

		const changeIcon = async (filePath: string, eventName: string, nickName: string) => {
			const eventChange = data.lastDiscordGuildEvent !== eventName;
			const nickChange = guild.members.me?.nickname !== nickName;
			const guildEvents = await guild.scheduledEvents.fetch();
			if (!eventChange && !nickChange) return;

			if (nickChange) {
				try {
					await bot.setNickname(nickName, "Random Motd name");
				} catch (err) {
					console.error(err);
				}
				data.lastDiscordNickName = nickName;
			}
			if (eventChange && !guildEvents.find(ev => ev.isActive())) {
				try {
					await guild.setIcon(
						filePath,
						eventName !== "None"
							? `It's ${eventName}!`
							: "Back to regularly scheduled activities."
					);
					await bot.discord.user?.setAvatar(filePath);
					data.lastDiscordGuildIcon = filePath;
				} catch (err) {
					console.error(err);
					return;
				}
				data.lastDiscordGuildEvent = eventName;
			}
			await data.save();
		};

		const checkDate = async () => {
			let filePath = defaultIconPath;
			let eventName = "None";
			let nick = "Meta";

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

			const wordList = data.lastMotd
				.split(" ")
				.filter(w => w.length <= 22 && !filter.includes(w.toLowerCase()));
			const word = wordList[(Math.random() * wordList?.length) | 0];
			nick = word.charAt(0).toUpperCase() + word.slice(1);

			return { filePath: filePath, eventName, nickName: nick };
		};

		const doIt = async () => {
			const { filePath, eventName, nickName } = await checkDate();
			changeIcon(filePath, eventName, nickName);
		};

		scheduleJob("0 0 * * *", doIt);
		doIt();
	});
};
