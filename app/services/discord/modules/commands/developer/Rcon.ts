import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashRconCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "rcon",
			description: "Executes a command on one of the gmod servers",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.STRING,
					name: "command",
					description: "The command to run",
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
		if (!bridge) return;
		const command = ctx.options.command.toString();
		const server = parseInt(ctx.options.server.toString());
		const response = {
			isLua: false,
			code: "",
			realm: "",
			command: command,
			runner: ctx.member?.displayName ?? "???",
			identifier: "",
		};

		await bridge.payloads.RconPayload.send(response, bridge.servers[server]);
		return EphemeralResponse("Sent");
	}
}
