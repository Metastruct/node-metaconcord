import * as Discord from "discord.js";

import { logger } from "#utils";
import { type DiscordBot } from "#/app/services/discord/index.ts";
import { gmodSlashCommands } from "#/app/services/gamebridge/games/gmod/commands/index.ts";
import { MenuDeeplCommand, SlashDeeplCommand } from "./DeepL.ts";
import {
	MenuManageMediaLinksCommand,
	SlashForceMotd,
	SlashManageMediaLinks,
} from "./developer/BotRelated.ts";
import { SlashEndEvent } from "./developer/Events.ts";
import { SlashFileCommand } from "./developer/File.ts";
import { SlashRuleCommand } from "./developer/Rules.ts";
import { SlashSQLCommand } from "./developer/SQL.ts";
import { SlashFluxerLinkCommand } from "./FluxerLink.ts";
import { MenuGetStickerUrlCommand } from "./GetStickerUrl.ts";
import { MenuGetVoiceMessageUrlCommand } from "./GetVoiceMessageUrl.ts";
import { SlashMarkovCommand } from "./Markov.ts";
import { MenuRemoveHighlightMessageCommand } from "./RemoveHighlightMessage.ts";
import { SlashRoleCommand } from "./Role.ts";
import { SlashRandomImageCommand } from "./Shitposting.ts";
import { SlashSpeechbubbleCommand } from "./Speechbubble.ts";
import { SlashVoiceCommand } from "./TempVoiceChannel.ts";
import { SlashVideoCommand } from "./Video.ts";
import { SlashWhyBanCommand } from "./WhyBan.ts";
import { MenuWhyRoleCommand } from "./WhyRole.ts";

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
	SlashFluxerLinkCommand,
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

export default function CommandsLoader(bot: DiscordBot): void {
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
		} catch (error) {
			log.error(error);
		}
	})();

	bot.discord.on("interactionCreate", async interaction => {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (error) {
				log.error({ interaction, err: error }, "slash commands");
			}
		} else if (interaction.isContextMenuCommand()) {
			const command = interaction.client.menuCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (error) {
				log.error({ interaction, err: error }, "menu commands");
			}
		} else if (interaction.isAutocomplete()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command || !command.autocomplete) return;
			try {
				await command.autocomplete(interaction, bot);
			} catch (error) {
				log.error({ interaction, err: error }, "autocomplete");
			}
		}
	});
}
