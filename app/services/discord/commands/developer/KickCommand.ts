import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashKickCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "kick",
			description: "Kick a player in-game",
			options: [
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description:
						"The steamid of the banned player in this format STEAM_0:0:000000000",
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
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "reason",
					description: "The reason for the ban",
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();

		const bridge = this.bot.container.getService("GameBridge");
		const server = ctx.options.server as number;
		const reason = ctx.options.reason ?? "byebye!!!";
		const code = `local ply = player.GetBySteamID("${ctx.options.steamid}") if not IsValid(ply) then return false end ply:Kick([[${reason}]])`;
		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			if (res.data.returns.length > 0 && res.data.returns[0] === "false") {
				await ctx.send("Invalid player");
				return;
			}

			await ctx.send("Kicked player");
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
