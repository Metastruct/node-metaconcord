import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashKickCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "kick",
			description: "Kick a player in-game",
			options: [
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
					name: "name",
					description: "The name of the player to kick",
					required: true,
					autocomplete: true,
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

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[] | undefined> {
		if (ctx.focused && ctx.focused == "name") {
			const players = await this.getPlayers(ctx.options.server ?? 2);
			if (!players) return undefined;
			return players.map(player => {
				return {
					name: player.nick,
					value: player.nick,
				} as AutocompleteChoice;
			});
		}
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		const bridge = this.bot.container.getService("GameBridge");
		if (!bridge) return;
		const server = ctx.options.server as number;
		const reason = ctx.options.reason ?? "byebye!!!";
		const code =
			`if not easylua then return false end ` +
			`local ply = easylua.FindEntity("${ctx.options.name}") ` +
			`if not IsValid(ply) or not ply:IsPlayer() then return false end ` +
			`ply:Kick([[${reason}]])`;
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
