import { endEvent } from "#/app/services/discord/modules/discord-events.ts";
import { type SlashCommand } from "#/extensions/discord.ts";

export const SlashEndEvent: SlashCommand = {
	options: {
		name: "end_event",
		description: "forcibly ends an event and removes the event role from users",
		default_member_permissions: "0",
	},
	execute: async () => {
		await endEvent();
	},
};
