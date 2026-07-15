import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import servers from "@/config/gamebridge.servers.json" with { type: "json" };

export const SlashRefreshLuaCommand: SlashCommand = {
	options: {
		name: "refreshlua",
		description: "Refreshes a lua file on one of the servers",
		default_member_permissions: "0",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "filepath",
				description:
					"The path to the lua file(s) to refresh separate with commas for multiple",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.Integer,
				name: "server",
				description: "The server to run the command on",
				choices: servers
					.filter(s => !!s.ssh)
					.map(s => {
						return { name: s.name, value: s.id };
					}),
				required: true,
			},
		],
	},

	async execute(ctx, bot) {
		const bridge = bot.bridge;
		if (!bridge) {
			ctx.reply(EphemeralResponse("GameBridge is missing :("));
			return;
		}

		const input = ctx.options.getString("filepath", true);
		const filePaths = input
			.split(",")
			.map(f => f.trim())
			.filter(f => f.length > 0);
		const code =
			'if not RefreshLua then return false, "Couldn\'t refresh file" end\n' +
			filePaths.map(f => `RefreshLua([[${f}]])`).join("\n");

		const server = bridge.servers[ctx.options.getInteger("server", true)];

		await ctx.deferReply();

		try {
			const res = await server.sendLua(code, "sv", ctx.user.displayName);

			if (!res) {
				await ctx.editReply("GameServer not connected :(");
				return;
			}

			if (res.data.returns.length > 0 && res.data.returns[0] === "false") {
				await ctx.editReply(res.data.returns[1] ?? "Unknown error");
				return;
			}

			if (filePaths.length === 1) {
				await ctx.editReply(`Refreshed \`${filePaths[0]}\``);
			} else {
				await ctx.editReply(
					`Refreshed ${filePaths.length} file(s):\n${filePaths.map(f => `\`${f}\``).join("\n")}`
				);
			}
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.editReply(errMsg);
		}
	},
};
