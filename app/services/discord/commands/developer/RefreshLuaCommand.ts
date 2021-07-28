import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashRefreshLuaCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "refreshlua",
			description: "Refreshes a lua file on one of the servers",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.STRING,
					name: "filepath",
					description: "The path to the lua file to refresh",
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
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		const bridge = this.bot.container.getService("GameBridge");
		const code = `if not RefreshLua then return false, "Couldn't refresh file" end return RefreshLua([[${ctx.options.filepath}]])`;
		const server = ctx.options.server as number;

		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			if (res.data.returns.length > 0 && res.data.returns[0] === "false") {
				await ctx.send(res.data[1] ?? "Unknown error");
				return;
			}

			await ctx.send(`Refreshed \`${ctx.options.filepath}\``);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
