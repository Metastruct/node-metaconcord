import { Command } from "detritus-client";
import { Data, DiscordBot } from "@/app/services";
export class BaseCommand extends Command.Command {
	protected bot: DiscordBot;
	protected data: Data;

	constructor(bot: DiscordBot, options?: Command.CommandOptions) {
		super(bot.discord, options);

		this.bot = bot;
		this.data = bot.container.getService("Data");
	}
}

import { HelpCommand } from "./HelpCommand";
import { MarkovCommand } from "./MarkovCommand";
import { MuteCommand, UnmuteCommand, WhyMuteCommand } from "./mute";
export default [HelpCommand, MarkovCommand, MuteCommand, UnmuteCommand, WhyMuteCommand];
