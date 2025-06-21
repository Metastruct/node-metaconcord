import * as Discord from "discord.js";
import { DiscordBot } from "../app/services/discord/index.js";
import DiscordConfig from "@/config/discord.json" with { type: "json" };

export function EphemeralResponse(content: string): Discord.InteractionReplyOptions {
	return { content: content, flags: Discord.MessageFlags.Ephemeral };
}

export interface SlashCommand {
	options: Discord.RESTPostAPIChatInputApplicationCommandsJSONBody;
	execute: (interaction: Discord.ChatInputCommandInteraction, bot: DiscordBot) => Promise<void>;
	autocomplete?: (interaction: Discord.AutocompleteInteraction, bot: DiscordBot) => Promise<void>;
	initialize?: (bot: DiscordBot) => Promise<void>;
	cooldown?: number;
}

export interface MenuCommand {
	options: Discord.RESTPostAPIContextMenuApplicationCommandsJSONBody;
	execute: (
		interaction:
			| Discord.UserContextMenuCommandInteraction
			| Discord.MessageContextMenuCommandInteraction,
		bot: DiscordBot
	) => Promise<void>;
	initialize?: (bot: DiscordBot) => Promise<void>;
	cooldown?: number;
}

declare module "discord.js" {
	interface Client {
		slashCommands: Discord.Collection<string, SlashCommand>;
		menuCommands: Discord.Collection<string, MenuCommand>;
	}
	interface User {
		mention: string;
	}
	interface GuildMember {
		mention: string;
		hasCustomRole: boolean;
		getCustomRole: Discord.Role | undefined;
	}
	interface Role {
		readonly isCustomRole: boolean;
	}
}

Object.defineProperty(Discord.User.prototype, "mention", {
	get(this: Discord.GuildMember) {
		return `<@${this.id}>`;
	},
});

Object.defineProperty(Discord.GuildMember.prototype, "mention", {
	get(this: Discord.GuildMember) {
		return `<@${this.id}>`;
	},
});

Object.defineProperty(Discord.Role.prototype, "isCustomRole", {
	get(this: Discord.Role) {
		return (
			this.name.endsWith(DiscordConfig.bot.roleIdentifier) || // legacy roles
			this.name.charAt(1) === DiscordConfig.bot.roleIdentifier
		);
	},
});

Object.defineProperty(Discord.GuildMember.prototype, "hasCustomRole", {
	get(this: Discord.GuildMember) {
		return this.roles.cache.some(role => role.isCustomRole);
	},
});

Object.defineProperty(Discord.GuildMember.prototype, "getCustomRole", {
	get(this: Discord.GuildMember) {
		return this.roles.cache.find(role => role.isCustomRole);
	},
});
