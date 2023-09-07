import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

export const SlashRefreshLuaCommand: SlashCommand = {
	options: {
		name: "refreshlua",
		description: "Refreshes a lua file on one of the servers",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "filepath",
				description: "The path to the lua file to refresh",
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
		if (!bridge) return;

		const filePath = ctx.options.getString("filepath", true);
		const code = `if not RefreshLua then return false, "Couldn't refresh file" end return RefreshLua([[${filePath}]])`;

		const server = ctx.options.getInteger("server", true);

		await ctx.deferReply();

		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.user.globalName ?? ctx.user.displayName
			);

			if (res.data.returns.length > 0 && res.data.returns[0] === "false") {
				await ctx.editReply(res.data.returns[1] ?? "Unknown error");
				return;
			}

			await ctx.editReply(`Refreshed \`${filePath}\``);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.editReply(errMsg);
		}
	},
};
