import { DiscordBot } from "../..";
import { MenuDeeplCommand, SlashDeeplCommand } from "./DeepL";
import { MenuGetStickerUrlCommand } from "./GetStickerUrl";
import { MenuGetVoiceMessageUrlCommand } from "./GetVoiceMessageUrl";
import { MenuManageMediaLinksCommand, SlashManageMediaLinks } from "./developer/ManageMediaLinks";
import { MenuWhyRoleCommand } from "./WhyRole";
import { SlashBanCommand } from "./developer/Ban";
import { SlashFileCommand } from "./developer/File";
import { SlashGservCommand } from "./developer/Gserv";
import { SlashKickCommand } from "./developer/Kick";
import { SlashLuaCommand } from "./developer/Lua";
import { SlashMarkovCommand } from "./Markov";
import { SlashRconCommand } from "./developer/Rcon";
import { SlashRefreshLuaCommand } from "./developer/RefreshLua";
import { SlashRoleCommand } from "./Role";
import { SlashRuleCommand } from "./developer/Rules";
import { SlashSQLCommand } from "./developer/SQL";
import { SlashSpeechbubbleCommand } from "./Speechbubble";
import { SlashUnBanCommand } from "./developer/UnBan";
import { SlashVoiceCommand } from "./TempVoiceChannel";
import { SlashWhyBanCommand } from "./WhyBan";
import Discord, { REST } from "discord.js";

export function EphemeralResponse(content: string): Discord.InteractionReplyOptions {
	return { content: content, ephemeral: true };
}

export const slashCommands = [
	// restricted commands
	SlashBanCommand,
	SlashFileCommand,
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

	const rest = new REST().setToken(bot.config.bot.token);

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
