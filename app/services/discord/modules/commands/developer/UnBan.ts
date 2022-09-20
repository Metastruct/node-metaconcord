import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashUnBanCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "unban",
			description: "Unbans a player in-game",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description:
						"The steamid of the banned player in this format STEAM_0:0:000000000",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "reason",
					description: "The reason for the unban",
					required: true,
				},
				{
					type: CommandOptionType.INTEGER,
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
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		const bridge = this.bot.container.getService("GameBridge");
		if (!bridge) return;
		const server = (ctx.options.server as number) ?? 2;
		const code =
			`if not banni then return false end ` +
			`local data = banni.UnBan("${ctx.options.steamid}", "Discord (${ctx.user.username}|${ctx.user.toString()})", [[${ctx.options.reason}]]) ` +
			`if istable(data) then return data.b == false else return data end`;
		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			if (res.data.returns.length > 0 && res.data.returns[0] === "true") {
				await ctx.send(`Unbanned \`${ctx.options.steamid}\``);
				return;
			}

			await ctx.send(`Could not unban \`${ctx.options.steamid}\``);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
