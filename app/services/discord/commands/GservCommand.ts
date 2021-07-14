import {
	ApplicationCommandOption,
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	Message,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import { NodeSSH } from "node-ssh";
import { TextChannel } from "discord.js";
import config from "@/ssh.json";

const VALID_GSERV_PARAMS: [string, string][] = [
	["rehash", "rehashes the server"],
	["merge_repos", "prepares all repos for rehash"],
	// ["kill", "Kills the server process (simulate crash)"],
	["rehashskeleton", "commits skeleton changes (call rehash afterwards!)"],
	["update_repos", "updates all svns/git repositories"],
	["status", "show server status"],
	["qu", "quick updates the repos"],
	["qu_rehash", "quick rehashes the server"],
];

const COMMAND_MAPPING: Map<string, Array<string>> = new Map<string, Array<string>>();
COMMAND_MAPPING.set("qu_rehash", ["qu", "rehash"]);

export class SlashGservCommand extends SlashCommand {
	private bot: DiscordBot;
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "gserv",
			description: "Gserv from discord",
			guildIDs: [bot.config.guildId],
			defaultPermission: false,
			permissions: {
				[bot.config.guildId]: [
					{
						type: ApplicationCommandPermissionType.ROLE,
						id: bot.config.developerRoleId,
						permission: true,
					},
				],
			},
			options: [],
		});
		this.filePath = __filename;
		this.bot = bot;

		for (const param of VALID_GSERV_PARAMS) {
			this.options.push({
				name: param[0],
				description: param[1],
				type: CommandOptionType.SUB_COMMAND,
				options: [
					{
						name: "server",
						description: "the server to run the command on",
						type: CommandOptionType.INTEGER,
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
			} as ApplicationCommandOption);
		}
	}

	private async gserv(
		ctx: CommandContext,
		host: string,
		username: string,
		port: string,
		param?: string
	): Promise<boolean> {
		const ssh = new NodeSSH();
		await ssh.connect({
			username: username,
			host: host,
			port: port,
			privateKey: config.keyPath,
		});

		let args = [param];
		if (COMMAND_MAPPING.has(param)) {
			args = COMMAND_MAPPING.get(param);
		}

		let output = "";
		await ssh.exec("gserv", args, {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		const success = !output.includes("GSERV FAILED");

		const fileName = `${args.join("_")}_${host}_${Date.now()}.txt`;
		let msgContent = host;
		if (!success) msgContent += " FAILED";

		const response = await ctx.send({
			content: msgContent,
			file: {
				file: Buffer.from(output, "utf8"),
				name: fileName,
			},
		});

		if (response instanceof Message) {
			const channel = (await this.bot.discord.channels.fetch(
				response.channelID
			)) as TextChannel;
			const msg = await channel.messages.fetch(response.id);
			await msg.react(success ? "👍" : "👎");
		}
		return success;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const command = Object.keys(ctx.options)[0];
		const server = (ctx.options[command] as any)?.server;

		const promises = config.servers
			.filter(
				(srvConfig: { host: string }) =>
					srvConfig.host.substr(1, 1) === server?.toString() || server == null
			)
			.map((srvConfig: { host: string; username: string; port: string }) =>
				this.gserv(ctx, srvConfig.host, srvConfig.username, srvConfig.port, command)
			);

		await Promise.all(promises);
	}
}
