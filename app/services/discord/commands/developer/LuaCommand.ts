import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";
import Discord from "discord.js";

export class SlashLuaCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "l",
			description: "Executes lua on one of the gmod servers",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.STRING,
					name: "code",
					description: "The code to run",
					required: true,
				},
				{
					type: CommandOptionType.INTEGER,
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
					type: CommandOptionType.STRING,
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
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const bridge = this.bot.container.getService("GameBridge");
		const code = ctx.options.code.replace("```", "") as string;
		const server = ctx.options.server as number;
		const realm = (ctx.options.realm ?? "sv") as string;

		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				realm,
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			const embed = new Discord.MessageEmbed();
			embed.setTitle("Metastruct #" + server);
			embed.setDescription(`\`\`\`lua\n${code.substring(0, 1999)}\`\`\``);
			embed.setColor(res.data.errors.length > 0 ? [255, 0, 0] : [0, 255, 0]);
			embed.setFooter(realm);

			if (res.data.stdout.length > 0) {
				embed.addField("Stdout", res.data.stdout.substring(0, 1999));
			}

			if (res.data.returns.length > 0) {
				embed.addField("Returns", res.data.returns.join("\n"));
			}

			if (res.data.errors.length > 0) {
				embed.addField("Errors", res.data.errors.join("\n"));
			}

			await ctx.send({
				embeds: [embed.toJSON()],
			});
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
