import { EphemeralResponse } from "..";
import { RconResponse } from "@/app/services/gamebridge/payloads/structures";
import { SlashCommand } from "@/extensions/discord";
import { f } from "@/utils";
import Discord from "discord.js";
import servers from "@/config/gamebridge.servers.json";

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
				choices: servers
					.filter(s => s.ssh)
					.map(s => {
						return { name: s.name, value: s.id };
					}),
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
		const bridge = bot.bridge;
		if (!bridge) {
			ctx.reply(EphemeralResponse("GameBridge is missing :("));
			console.error(`SlashLua: GameBridge missing?`, ctx);
			return;
		}
		await ctx.deferReply();
		const code = ctx.options.getString("code", true).replace(/```(?:lua\n?)?/g, "");
		const server = bridge.servers[ctx.options.getInteger("server", true)];
		const realm = ctx.options.getString("realm") ?? "sv";

		try {
			const res = await server.sendLua(
				code,
				realm as RconResponse["realm"],
				ctx.user.displayName ?? "???"
			);

			if (!res) {
				ctx.followUp(EphemeralResponse("Server isn't connected:("));
				return;
			}

			const embed = new Discord.EmbedBuilder();
			embed.setTitle(server.config.name);
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
