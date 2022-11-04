import { DiscordBot } from "..";

const DESIRED_LEVEL = 3; // 2 is also ok but eh just for testing

export default (bot: DiscordBot): void => {
	const setProgressBar = async () => {
		const guild = await bot.discord.guilds.fetch(bot.config.guildId);
		if (guild.premiumTier < DESIRED_LEVEL) {
			if (!guild.premiumProgressBarEnabled) {
				await guild.setPremiumProgressBarEnabled(true);
			}
		} else {
			if (guild.premiumProgressBarEnabled) {
				await guild.setPremiumProgressBarEnabled(false);
			}
		}
	};
	setProgressBar();
	setInterval(setProgressBar, 1000 * 60 * 60 * 24);
};
