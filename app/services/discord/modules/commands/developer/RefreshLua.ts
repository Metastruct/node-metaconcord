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
				description: "The path to the lua file to refresh",
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
			console.error(`SlashRefreshLua: GameBridge missing?`, ctx);
			return;
		}

		const filePath = ctx.options.getString("filepath", true);
		const code = `if not RefreshLua then return false, "Couldn't refresh file" end return RefreshLua([[${filePath}]])`;

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

			await ctx.editReply(`Refreshed \`${filePath}\``);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.editReply(errMsg);
		}
	},
};
