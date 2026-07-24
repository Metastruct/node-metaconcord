import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import servers from "@/config/gmod.servers.json" with { type: "json" };

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
				required: false,
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

		const serverId = ctx.options.getInteger("server");
		const where = serverId
			? bridge.servers[serverId] instanceof GmodConnection
				? [bridge.servers[serverId] as GmodConnection]
				: []
			: bridge.servers.filter(
					(s): s is GmodConnection => s instanceof GmodConnection && !!s.config.ssh
				);

		await ctx.deferReply();

		if (where.length === 0) {
			await ctx.editReply("That server isn't a GMod server.");
			return;
		}

		try {
			const results = await Promise.all(
				where.map(async server => {
					const res = await server.sendLua(code, "sv", ctx.user.displayName);
					return { server, res };
				})
			);

			const failed = results.filter(r => !r.res);
			if (failed.length > 0) {
				const names = failed
					.map(r =>
						r.server.discord.ready
							? `<@${r.server.discord.user?.id}>`
							: `#${r.server.config.id}`
					)
					.join(", ");
				await ctx.editReply(`GameServer not connected: ${names}`);
				return;
			}

			const errored = results.filter(
				r => r.res && r.res.data.returns.length > 0 && r.res.data.returns[0] === "false"
			);
			if (errored.length > 0) {
				const msgs = errored
					.map(
						r =>
							`${r.server.discord.ready ? `<@${r.server.discord.user?.id}>` : `#${r.server.config.id}`}: ${r.res!.data.returns[1] ?? "Unknown error"}`
					)
					.join("\n");
				await ctx.editReply(msgs);
				return;
			}

			const fileList =
				filePaths.length === 1
					? `\`${filePaths[0]}\``
					: `${filePaths.length} file(s):\n${filePaths.map(f => `\`${f}\``).join("\n")}`;
			if (where.length === 1) {
				await ctx.editReply(`Refreshed ${fileList}`);
			} else {
				const serverNames = where
					.map(s => (s.discord.ready ? `<@${s.discord.user?.id}>` : `#${s.config.id}`))
					.join(", ");
				await ctx.editReply(`Refreshed ${fileList} on ${serverNames}`);
			}
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.editReply(errMsg);
		}
	},
};
