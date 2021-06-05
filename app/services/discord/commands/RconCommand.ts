import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import EphemeralResponse from ".";

export class SlashRconCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "rcon",
			description: "Executes a command on one of the gmod servers",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			permissions: {
				[bot.config.guildId]: [
					{
						type: ApplicationCommandPermissionType.ROLE,
						id: bot.config.developerRoleId,
						permission: true,
					},
				],
			},
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
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		const bridge = this.bot.container.getService("GameBridge");
		const command = ctx.options.command.toString();
		const server = ctx.options.server?.toString();
		const response = {
			isLua: false,
			code: "",
			realm: "",
			command: command,
			runner: ctx.member?.displayName ?? "???",
		};

		if (server) {
			const serverIndex = parseInt(server);
			await bridge.payloads.RconPayload.send(response, bridge.servers[serverIndex]);
		} else {
			await Promise.all(
				bridge.servers.map(srv => bridge.payloads.RconPayload.send(response, srv))
			);
		}

		return EphemeralResponse("Sent");
	}
}
