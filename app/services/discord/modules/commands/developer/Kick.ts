import * as Discord from "discord.js";
import { Player } from "@/app/services/gamebridge/GameServer.js";
import { SlashCommand } from "@/extensions/discord.js";
import servers from "@/config/gamebridge.servers.json" with { type: "json" };

export const SlashKickCommand: SlashCommand = {
	options: {
		name: "kick",
		description: "Kick a player in-game",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
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
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "name",
				description: "The name of the player to kick",
				required: true,
				autocomplete: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "reason",
				description: "The reason for the kick",
				required: false,
			},
		],
	},

	async execute(ctx, bot) {
		await ctx.deferReply();
		const bridge = bot.bridge;
		if (!bridge) return;
		const server = bridge.servers[ctx.options.getInteger("server", true)];
		const reason = ctx.options.getString("reason") ?? "byebye!!!";
		const code =
			`if not easylua then return false end ` +
			`local ply = easylua.FindEntity("${ctx.options.getString("name")}") ` +
			`if not IsValid(ply) or not ply:IsPlayer() then return false end ` +
			`ply:Kick([[${reason}]])`;
		try {
			const res = await server.sendLua(code, "sv", ctx.user.username ?? "???");

			if (res && res.data.returns.length > 0 && res.data.returns[0] === "false") {
				await ctx.followUp("Invalid player");
				return;
			}

			await ctx.followUp("Kicked player");
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.followUp(errMsg);
		}
	},
	async autocomplete(ctx, bot) {
		const players = bot.bridge?.servers[ctx.options.getInteger("server") ?? 2]?.status.players;
		if (!players) {
			await ctx.respond([]);
			return;
		}
		const focused = ctx.options.getFocused();
		await ctx.respond(
			players
				.filter(
					function (player: Player) {
						if (this.limit < 25) {
							this.limit++;
							return player.nick.includes(focused);
						}
					},
					{ limit: 0 }
				)
				.map(player => {
					return {
						name: player.nick.substring(0, 100),
						value: player.nick.substring(0, 100),
					};
				})
		);
	},
};
