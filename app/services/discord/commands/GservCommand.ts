import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import { NodeSSH } from "node-ssh";
import EphemeralResponse from ".";
import config from "ssh.json";

const VALID_GSERV_PARAMS = {
	rehash: true,
	merge_repos: true,
	kill: true,
	rehashskeleton: true,
	update_repos: true,
	status: true,
};

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
			options: [
				{
					type: CommandOptionType.STRING,
					name: "param",
					description: "gserv param",
					required: false,
				},
			],
		});
		this.filePath = __filename;
	}

	private async gserv(
		ctx: CommandContext,
		host: string,
		port: string,
		param?: string
	): Promise<boolean> {
		if (!param) param = "rehash";
		if (VALID_GSERV_PARAMS[param]) return false;

		try {
			const ssh = new NodeSSH();
			await ssh.connect({
				host: host,
				port: port,
				privateKey: config.keyPath,
			});

			let output = "";
			await ssh.exec("gserv", [param], {
				onStdout: buff => (output += buff),
				onStderr: buff => (output += buff),
			});

			if (output.length > 1994) {
				output = output.substring(0, 1990) + "...";
			}

			output = `\`\`\`${output}\`\`\``;
			await ctx.send(output);
		} catch (err) {
			ctx.send(err);
			return false;
		}
	}

	async run(ctx: CommandContext): Promise<any> {
		const param = ctx.options.param?.toString();
		const promises = config.servers.map(srvConfig =>
			this.gserv(ctx, srvConfig.host, srvConfig.port, param)
		);

		const results = await Promise.all(promises);
		for (const result of results) {
			if (!result) return EphemeralResponse("Failed");
		}

		return EphemeralResponse("Success");
	}
}
