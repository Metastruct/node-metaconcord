import { DiscordBot } from "../index.js";

const LVL_MAP = [
	[0, 2],
	[1, 7],
	[2, 14],
	[3, 14],
];

export default (bot: DiscordBot): void => {
	const setProgressBar = async () => {
		const guild = bot.getGuild();
		const count = guild?.premiumSubscriptionCount;
		const validPerks = ["ENHANCED_ROLE_COLORS", "GUILD_TAGS"];
		const addedPerks = guild?.features.filter(f => validPerks.includes(f));
		if (!count) return;
		const needed = LVL_MAP[guild.premiumTier][1] + (addedPerks?.length ?? 0) * 3;
		if (count < needed && count / needed >= 0.8) {
			if (!guild.premiumProgressBarEnabled) {
				await guild.setPremiumProgressBarEnabled(true);
			}
		} else {
			if (guild.premiumProgressBarEnabled) {
				await guild.setPremiumProgressBarEnabled(false);
			}
		}
	};
	bot.discord.on("clientReady", setProgressBar);
	bot.discord.on("guildUpdate", (oldGuild, newGuild) => {
		// not sure if this actually works
		if (oldGuild.premiumTier !== newGuild.premiumTier) setProgressBar();
	});
	bot.discord.on("guildMemberUpdate", async (oldMember, updatedMember) => {
		if (
			updatedMember.premiumSinceTimestamp &&
			Date.now() - updatedMember.premiumSinceTimestamp < 1000 * 60
		)
			setProgressBar();
	});
};
