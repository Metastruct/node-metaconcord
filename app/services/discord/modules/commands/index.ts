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
import { SlashBanCommand } from "./developer/Ban.js";
import { SlashEndEvent } from "./developer/Events.js";
import { SlashFileCommand } from "./developer/File.js";
import { SlashGservCommand } from "./developer/Gserv.js";
import { SlashKickCommand } from "./developer/Kick.js";
import { SlashLuaCommand } from "./developer/Lua.js";
import { SlashMarkovCommand } from "./Markov.js";
import { SlashRandomImageCommand } from "./Shitposting.js";
import { SlashRconCommand } from "./developer/Rcon.js";
import { SlashRefreshLuaCommand } from "./developer/RefreshLua.js";
import { SlashRoleCommand } from "./Role.js";
import { SlashRuleCommand } from "./developer/Rules.js";
import { SlashSpeechbubbleCommand } from "./Speechbubble.js";
import { SlashSQLCommand } from "./developer/SQL.js";
import { SlashUnBanCommand } from "./developer/UnBan.js";
import { SlashVoiceCommand } from "./TempVoiceChannel.js";
import { SlashWhyBanCommand } from "./WhyBan.js";

export const slashCommands = [
	// restricted commands
	SlashBanCommand,
	SlashEndEvent,
	SlashFileCommand,
	SlashForceMotd,
	SlashGservCommand,
	SlashKickCommand,
	SlashLuaCommand,
	SlashManageMediaLinks,
	SlashRconCommand,
	SlashRefreshLuaCommand,
	SlashRuleCommand,
	SlashSQLCommand,
	SlashUnBanCommand,
	// normal commands
	SlashDeeplCommand,
	SlashMarkovCommand,
	SlashRoleCommand,
	SlashRandomImageCommand,
	SlashSpeechbubbleCommand,
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
			console.debug(`Refreshing ${commands.length} commands.`);
			await rest.put(
				Discord.Routes.applicationGuildCommands(
					bot.config.bot.applicationId,
					bot.config.bot.primaryGuildId
				),
				{ body: commands }
			);
			console.debug(`Successfully refreshed ${commands.length} commands.`);
		} catch (err) {
			console.error(err);
		}
	})();

	bot.discord.on("interactionCreate", async interaction => {
		if (interaction.isChatInputCommand()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (err) {
				console.error("slash commands:", interaction, err);
			}
		} else if (interaction.isContextMenuCommand()) {
			const command = interaction.client.menuCommands.get(interaction.commandName);
			if (!command) return;
			try {
				await command.execute(interaction, bot);
			} catch (err) {
				console.error("menu commands:", interaction, err);
			}
		} else if (interaction.isAutocomplete()) {
			const command = interaction.client.slashCommands.get(interaction.commandName);
			if (!command || !command.autocomplete) return;
			try {
				await command.autocomplete(interaction, bot);
			} catch (err) {
				console.error("autocomplete:", interaction, err);
			}
		}
	});
};
