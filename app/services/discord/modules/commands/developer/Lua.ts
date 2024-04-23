import { EphemeralResponse } from "..";
import { RconResponse } from "@/app/services/gamebridge/payloads/structures";
import { SlashCommand } from "@/extensions/discord";
import { f } from "@/utils";
import Discord from "discord.js";

export const SlashLuaCommand: SlashCommand = {
	options: {
		name: "l",
		description: "Executes lua on one of the gmod servers",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "code",
				description: "The code to run",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.Integer,
				name: "server",
				description: "The server to run the code on",
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
				name: "realm",
				description: "The realm to run the code on",
				choices: [
					{
						name: "server",
						value: "sv",
					},
					{
						name: "shared",
						value: "sh",
					},
					{
						name: "clients",
						value: "cl",
					},
				],
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
		const code = ctx.options.getString("code", true).replace(/```(?:lua\n?)?/g, "");
		const server = ctx.options.getInteger("server", true);
		const realm = ctx.options.getString("realm") ?? "sv";

		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				realm as RconResponse["realm"],
				bridge.servers[server],
				ctx.user.displayName ?? "???"
			);

			const embed = new Discord.EmbedBuilder();
			embed.setTitle("Metastruct #" + server);
			embed.setDescription(`\`\`\`lua\n${code.substring(0, 1999)}\`\`\``);
			embed.setColor(res.data.errors.length > 0 ? [255, 0, 0] : [0, 255, 0]);
			embed.setFooter({ text: realm });

			if (res.data.stdout.length > 0) {
				embed.addFields(f("Stdout", res.data.stdout.substring(0, 1999)));
			}

			if (res.data.returns.length > 0) {
				embed.addFields(f("Returns", res.data.returns.join("\n")));
			}

			if (res.data.errors.length > 0) {
				embed.addFields(f("Errors", res.data.errors.join("\n")));
			}

			await ctx.followUp({
				embeds: [embed.toJSON()],
			});
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.followUp(errMsg);
		}
	},
};
