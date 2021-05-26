import {
	ApplicationCommandOption,
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import { NodeSSH } from "node-ssh";
import EphemeralResponse from ".";
import config from "@/ssh.json";

const VALID_GSERV_PARAMS: [string, string][] = [
	["rehash", "rehashes the server"],
	["merge_repos", "prepares all repos for rehash"],
	// ["kill", "Kills the server process (simulate crash)"],
	["rehashskeleton", "commits skeleton changes (call rehash afterwards!)"],
	["update_repos", "updates all svns/git repositories"],
	["status", "show server status"],
];

export class SlashGservCommand extends SlashCommand {
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

		for (const param of VALID_GSERV_PARAMS) {
			this.options.push({
				name: param[0],
				description: param[1],
				type: CommandOptionType.SUB_COMMAND,
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

		let output = "";
		await ssh.exec("gserv", [param], {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		if (output.length + host.length > 1994) {
			output = output.substring(0, 1990 - host.length) + "...";
		}

		output = `${host}\n\`\`\`${output}\`\`\``;
		await ctx.send(output);

		return true;
	}

	async run(ctx: CommandContext): Promise<any> {
		const param = Object.keys(ctx.options)[0];
		const promises = config.servers.map(srvConfig =>
			this.gserv(ctx, srvConfig.host, srvConfig.username, srvConfig.port, param)
		);

		const results = await Promise.all(promises);
		for (const result of results) {
			if (!result) return EphemeralResponse("Failed");
		}

		return EphemeralResponse("Success");
	}
}
