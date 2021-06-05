import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import EphemeralResponse from ".";

export class SlashLuaCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "lua",
			description: "Executes lua on one of the gmod servers",
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
		const bridge = this.bot.container.getService("GameBridge");
		const code = ctx.options.code.toString();
		const server = parseInt(ctx.options.server.toString());
		const realm = ctx.options.realm?.toString() ?? "sv";
		const response = {
			isLua: true,
			code: code,
			realm: realm,
			command: "",
			runner: ctx.member?.displayName ?? "???",
		};

		await bridge.payloads.RconPayload.send(response, bridge.servers[server]);
		return EphemeralResponse("Sent");
	}
}
