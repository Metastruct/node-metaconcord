import { EphemeralResponse } from "..";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
import SteamID from "steamid";
import servers from "@/config/gamebridge.servers.json";

export const SlashUnBanCommand: SlashCommand = {
	options: {
		name: "unban",
		description: "Unbans a player in-game",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "steamid",
				description: "the steamid64 of the player to ban",
				required: true,
				autocomplete: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "reason",
				description: "The reason for the ban",
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
			},
		],
	},

	async execute(ctx, bot) {
		const bridge = bot.bridge;
		if (!bridge) {
			ctx.reply(EphemeralResponse("GameBridge is missing :("));
			console.error(`SlashUnBan: GameBridge missing?`, ctx);
			return;
		}
		await ctx.deferReply();
		const server = bridge.servers[ctx.options.getInteger("server") ?? 2];
		const steamid = ctx.options.getString("steamid", true);
		const code =
			`if not banni then return false end ` +
			`local data = banni.UnBan("${steamid}", "Discord (${ctx.user.username}|${
				ctx.user.mention
			})", [[${ctx.options.getString("reason")}]]) ` +
			`if istable(data) then return data.b == false else return data end`;
		try {
			const res = await server.sendLua(code, "sv", ctx.user.displayName ?? "???");

			if (!res) {
				await ctx.editReply("GameServer not connected :(");
				return;
			}

			if (res.data.returns.length > 0 && res.data.returns[0] === "true") {
				await ctx.followUp(`Unbanned \`${steamid}\``);
				return;
			}

			await ctx.followUp(`Could not unban \`${steamid}\``);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.followUp(errMsg);
		}
	},

	async autocomplete(ctx, bot) {
		const banService = bot.container.getService("Bans");
		if (!banService) return;
		const list = await banService.getBanList();
		if (!list) {
			ctx.respond([]);
			return;
		}
		await ctx.respond(
			list
				.filter(
					function (ban) {
						if (this.limit < 25) {
							const name = ban.sid.toLowerCase().includes(ctx.options.getFocused());
							const sid = new SteamID(ban.sid);
							const sid2 = sid
								.getSteam2RenderedID()
								.includes(ctx.options.getFocused().toUpperCase());
							const sid3 = sid
								.getSteam3RenderedID()
								.includes(ctx.options.getFocused().toUpperCase());
							const sid64 = sid.getSteamID64().includes(ctx.options.getFocused());
							const res = name || sid2 || sid64 || sid3;
							if (!res) return false;
							this.limit++;
							return res;
						}
					},
					{ limit: 0 }
				)
				.map(ban => {
					const namefix = ban.name.replace(/(\u180C|\u0020)/g, ""); // that one ban I swear on me mum is driving me insane
					return {
						name: `${ban.sid} (${namefix.length > 0 ? namefix : "invalid name"})`,
						value: ban.sid,
					};
				})
		);
	},
};
