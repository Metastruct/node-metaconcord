import * as Discord from "discord.js";
import { SlashCommand } from "@/extensions/discord.js";
import { endEvent } from "@/app/services/discord/modules/discord-events.js";

export const SlashEndEvent: SlashCommand = {
	options: {
		name: "end_event",
		description: "forcibly ends an event and removes the event role from users",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
	},
	execute: async () => {
		await endEvent();
	},
};
