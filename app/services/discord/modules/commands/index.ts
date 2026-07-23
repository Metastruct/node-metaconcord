import * as Discord from "discord.js";
import { DiscordBot } from "@/app/services/discord/index.js";
import { MenuDeeplCommand, SlashDeeplCommand } from "./DeepL.js";
import { MenuGetStickerUrlCommand } from "./GetStickerUrl.js";
import { MenuGetVoiceMessageUrlCommand } from "./GetVoiceMessageUrl.js";
import {
	MenuManageMediaLinksCommand,
	SlashForceMotd,
	SlashManageMediaLinks,
} from "./developer/BotRelated.js";
import { MenuRemoveHighlightMessageCommand } from "./RemoveHighlightMessage.js";
import { MenuWhyRoleCommand } from "./WhyRole.js";
import { SlashEndEvent } from "./developer/Events.js";
import { SlashFileCommand } from "./developer/File.js";
import { SlashMarkovCommand } from "./Markov.js";
import { SlashRandomImageCommand } from "./Shitposting.js";
import { SlashRoleCommand } from "./Role.js";
import { SlashRuleCommand } from "./developer/Rules.js";
import { SlashSpeechbubbleCommand } from "./Speechbubble.js";
import { SlashSQLCommand } from "./developer/SQL.js";
import { SlashVideoCommand } from "./Video.js";
import { SlashVoiceCommand } from "./TempVoiceChannel.js";
import { SlashWhyBanCommand } from "./WhyBan.js";
import { gmodSlashCommands } from "@/app/services/gamebridge/games/gmod/commands/index.js";
import { logger } from "@/utils.js";

const log = logger("Commands");

export const slashCommands = [
	// restricted commands
	...gmodSlashCommands,
	SlashEndEvent,
	SlashFileCommand,
	SlashForceMotd,
	SlashManageMediaLinks,
	SlashRuleCommand,
	SlashSQLCommand,
	// normal commands
	SlashDeeplCommand,
	SlashMarkovCommand,
	SlashRoleCommand,
	SlashRandomImageCommand,
	SlashSpeechbubbleCommand,
	SlashVideoCommand,
	SlashVoiceCommand,
	SlashWhyBanCommand,
];
export const menuCommands = [
	// restricted menuCommands
	MenuManageMediaLinksCommand,
	// normal menuCommands
	MenuDeeplCommand,
	MenuGetStickerUrlCommand,
	MenuGetVoiceMessageUrlCommand,
	MenuRemoveHighlightMessageCommand,
	MenuWhyRoleCommand,
];

export default (bot: DiscordBot): void => {
	bot.discord.slashCommands = new Discord.Collection();
	bot.discord.menuCommands = new Discord.Collection();

	const commands: Discord.RESTPostAPIApplicationCommandsJSONBody[] = [];

	for (const slashCmd of slashCommands) {
		slashCmd.initialize?.(bot);
		bot.discord.slashCommands.set(slashCmd.options.name, slashCmd);
		commands.push(slashCmd.options);
	}

	for (const menuCommand of menuCommands) {
		menuCommand.initialize?.(bot);
		bot.discord.menuCommands.set(menuCommand.options.name, menuCommand);
		commands.push(menuCommand.options);
	}

	const rest = new Discord.REST().setToken(bot.config.bot.token);

	(async () => {
		try {
			log.debug(`Refreshing ${commands.length} commands.`);
			await rest.put(
				Discord.Routes.applicationGuildCommands(
					bot.config.bot.applicationId,
					bot.config.bot.primaryGuildId
				),
				{ body: commands }
			);
			log.debug(`Successfully refreshed ${commands.length} commands.`);
		} catch (err) {
			log.error(err);
		}
	})();

	bot.discord.on("interactionCreate", async interaction => {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (err) {
				log.error({ interaction, err }, "slash commands");
			}
		} else if (interaction.isContextMenuCommand()) {
			const command = interaction.client.menuCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (err) {
				log.error({ interaction, err }, "menu commands");
			}
		} else if (interaction.isAutocomplete()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command || !command.autocomplete) return;
			try {
				await command.autocomplete(interaction, bot);
			} catch (err) {
				log.error({ interaction, err }, "autocomplete");
			}
		}
	});
};
