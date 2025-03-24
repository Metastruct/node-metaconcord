import { SlashCommand } from "@/extensions/discord";
import { endEvent } from "../../discord-events";
import Discord from "discord.js";

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
