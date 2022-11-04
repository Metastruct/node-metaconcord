import {
	ButtonStyle,
	CommandContext,
	ComponentContext,
	ComponentSelectOption,
	ComponentType,
	Message,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";
import { NodeSSH } from "node-ssh";
import { SlashDeveloperCommand } from "./DeveloperCommand";
import { TextChannel } from "discord.js";
import config from "@/config/ssh.json";

// order matters for the menu
const VALID_GSERV_COMMANDS: [string, string][] = [
	["qu", "Quickly updates repositories."],
	["rehash", "Rehashes the server."],
	["merge_repos", "Prepares all repositories for rehash."],
	["rehashskeleton", "Commits skeleton changes. Call rehash afterwards!"],
	["update_repos", "Updates all SVN/Git repositories."],
	["status", "Shows server status."],
];

const SERVER_EMOJI_MAP = {
	"1": "1️⃣",
	"2": "2️⃣",
	"3": "3️⃣",
};

export class SlashGservAllCommand extends SlashDeveloperCommand {
	private commandOptions: ComponentSelectOption[] = [];
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "gservall",
			description: "Run gserv from discord on all servers.",
		});

		this.filePath = __filename;
		this.bot = bot;

		for (const cmd of VALID_GSERV_COMMANDS) {
			this.commandOptions.push({
				label: cmd[0],
				value: cmd[0],
				description: cmd[1],
			} as ComponentSelectOption);
		}
	}

	private stripControlChars(input: string) {
		return input
			.split("")
			.filter(x => {
				if (x === "\n") return true;

				const n = x.charCodeAt(0);
				return 31 < n && 127 > n;
			})
			.join("");
	}

	private async gserv(
		ctx: ComponentContext,
		host: string,
		username: string,
		port: number,
		commands: string[],
		solo: boolean,
		output: boolean
	): Promise<boolean> {
		const ssh = new NodeSSH();
		await ssh.connect({
			username: username,
			host: host,
			port: port,
			privateKeyPath: config.keyPath,
		});

		let buffer = "";
		await ssh.exec("gserv", commands, {
			stream: "stderr",
			onStdout: buff => (buffer += buff),
			onStderr: buff => (buffer += buff),
		});

		buffer = this.stripControlChars(buffer);
		const success = !buffer.includes("GSERV FAILED");

		const fileName = `${commands.join("_")}_${host}_${Date.now()}.txt`;
		let msgContent = host;
		if (!success) msgContent += " FAILED";

		const response = {
			content: msgContent,
			file: {
				file: Buffer.from(buffer, "utf8"),
				name: fileName,
			},
		};

		if (output || success === false) {
			const sent = solo ? await ctx.editParent(response) : await ctx.send(response);

			if (sent instanceof Message) {
				const channel = (await this.bot.discord.channels.fetch(
					sent.channelID
				)) as TextChannel;
				const msg = await channel.messages.fetch(sent.id);
				await msg.react(success ? "✅" : "❌");
			}
		} else {
			const channel = (await this.bot.discord.channels.fetch(ctx.channelID)) as TextChannel;
			const msg = await channel.messages.fetch(ctx.message.id);
			await msg.react(SERVER_EMOJI_MAP[host.slice(1, 2)] ?? "❓");
		}
		return success;
	}

	private async send(
		ctx: ComponentContext,
		commands: string[],
		servers: string[],
		output: boolean
	) {
		ctx.editParent(
			`Running ${commands.join(" and ")} on ${servers
				.slice()
				.sort()
				.join(", ")} please wait...`,
			{ components: [] }
		);
		const promises = config.servers
			.filter(
				(srvConfig: { host: string }) =>
					servers.find(srv => srvConfig.host.slice(1, 2) === srv) != undefined
			)
			.map((srvConfig: { host: string; username: string; port: number }) =>
				this.gserv(
					ctx,
					srvConfig.host,
					srvConfig.username,
					srvConfig.port,
					commands,
					servers.length === 1,
					output
				)
			);
		await Promise.all(promises).catch(err =>
			ctx.send(`something went wrong!\`\`\`\n${err}\`\`\``)
		);
	}

	private deny(ctx: CommandContext) {
		return EphemeralResponse(`This command can only be used by ${ctx.user.username}`);
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		const user = ctx.user;
		let commands: string[];
		await ctx.send("What command do you want to run?", {
			components: [
				{
					type: ComponentType.ACTION_ROW,
					components: [
						{
							type: ComponentType.SELECT,
							custom_id: "gserv_command",
							placeholder: "Choose a command.",
							min_values: 1,
							max_values: VALID_GSERV_COMMANDS.length,
							options: this.commandOptions,
						},
					],
				},
			],
		});

		ctx.registerComponent("gserv_command", async (selected: ComponentContext) => {
			if (selected.user.id !== user.id) {
				selected.send(this.deny(ctx));
				return;
			}
			commands = selected.values;

			const servers = config.servers.map(s => s.host.slice(1, 2));
			await selected.editParent("Display output?", {
				components: [
					{
						type: ComponentType.ACTION_ROW,
						components: [
							{
								type: ComponentType.BUTTON,
								custom_id: "gserv_output_n",
								label: "No",
								style: ButtonStyle.DESTRUCTIVE,
							},
							{
								type: ComponentType.BUTTON,
								custom_id: "gserv_output_y",
								label: "Yes",
								style: ButtonStyle.SUCCESS,
							},
						],
					},
				],
			});
			ctx.registerComponent("gserv_output_n", async (selected: ComponentContext) => {
				this.send(selected, commands, servers, false);
			});
			ctx.registerComponent("gserv_output_y", async (selected: ComponentContext) => {
				this.send(selected, commands, servers, true);
			});
		});
	}
}
