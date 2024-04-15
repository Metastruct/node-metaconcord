import { Player } from "@/app/services/gamebridge";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";

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
		const bridge = bot.container.getService("GameBridge");
		if (!bridge) return;
		const server = ctx.options.getInteger("server", true);
		const reason = ctx.options.getString("reason") ?? "byebye!!!";
		const code =
			`if not easylua then return false end ` +
			`local ply = easylua.FindEntity("${ctx.options.getString("name")}") ` +
			`if not IsValid(ply) or not ply:IsPlayer() then return false end ` +
			`ply:Kick([[${reason}]])`;
		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.user.username ?? "???"
			);

			if (res.data.returns.length > 0 && res.data.returns[0] === "false") {
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
		const players =
			bot.container.getService("GameBridge")?.servers[ctx.options.getInteger("server") ?? 2]
				.status.players;
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
