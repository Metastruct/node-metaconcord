import { EphemeralResponse } from "..";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const SlashRconCommand: SlashCommand = {
	options: {
		name: "rcon",
		description: "Executes a command on one of the gmod servers",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "command",
				description: "The command to run",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.Integer,
				name: "server",
				description: "The server to run the command on",
				choices: [
					{
						name: "g1",
						value: 1,
					},
					{
						name: "g2",
						value: 2,
					},
					{
						name: "g3",
						value: 3,
					},
				],
				required: true,
			},
		],
	},

	async execute(ctx, bot) {
		const bridge = bot.container.getService("GameBridge");
		if (!bridge) {
			ctx.reply(EphemeralResponse("GameBridge is missing :("));
			console.error(`SlashLua: GameBridge missing?`, ctx);
			return;
		}
		await ctx.deferReply();
		const command = ctx.options.getString("command", true);
		const server = ctx.options.getInteger("server", true);
		const response = {
			isLua: false,
			command: command,
			runner: ctx.user.displayName ?? "???",
		};

		await bridge.payloads.RconPayload.send(response, bridge.servers[server]);
		await ctx.followUp("Sent command sucessfully.");
	},
};
