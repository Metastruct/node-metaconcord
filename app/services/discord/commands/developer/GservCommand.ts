/* eslint-disable @typescript-eslint/no-unused-vars */
import {
	CommandContext,
	ComponentContext,
	ComponentSelectOption,
	ComponentType,
	Message,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { NodeSSH } from "node-ssh";
import { SlashDeveloperCommand } from "./DeveloperCommand";
import { TextChannel } from "discord.js";
import EphemeralResponse from "..";
import config from "@/ssh.json";

// order matters for the menu
const VALID_GSERV_COMMANDS: [string, string][] = [
	["qu", "quick updates the repos"],
	["rehash", "rehashes the server"],
	["merge_repos", "prepares all repos for rehash"],
	["rehashskeleton", "commits skeleton changes (call rehash afterwards!)"],
	["update_repos", "updates all svns/git repositories"],
	["status", "show server status"],
];

export class SlashGservCommand extends SlashDeveloperCommand {
	private commandOptions: ComponentSelectOption[] = [];
	private serverOptions: ComponentSelectOption[] = [];
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "gserv",
			description: "Gserv from discord",
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
		for (const server of config.servers) {
			this.serverOptions.push({
				label: server.host.substr(0, 2), // [g1].metastruct.net
				value: server.host.substr(1, 1), // g[1].metastruct.net
				description: server.host, // g1.metastruct.net
			} as ComponentSelectOption);
		}
	}

	private async gserv(
		ctx: ComponentContext,
		host: string,
		username: string,
		port: string,
		commands: string[],
		solo: boolean
	): Promise<boolean> {
		const ssh = new NodeSSH();
		await ssh.connect({
			username: username,
			host: host,
			port: port,
			privateKey: config.keyPath,
		});

		let output = "";
		await ssh.exec("gserv", commands, {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		const success = !output.includes("GSERV FAILED");

		const fileName = `${commands.join("_")}_${host}_${Date.now()}.txt`;
		let msgContent = host;
		if (!success) msgContent += " FAILED";

		const response = {
			content: msgContent,
			file: {
				file: Buffer.from(output, "utf8"),
				name: fileName,
			},
		};

		const sent = solo ? await ctx.editParent(response) : await ctx.send(response);

		if (sent instanceof Message) {
			const channel = (await this.bot.discord.channels.fetch(sent.channelID)) as TextChannel;
			const msg = await channel.messages.fetch(sent.id);
			await msg.react(success ? "👍" : "👎");
		}
		return success;
	}
	private deny(ctx: CommandContext) {
		return EphemeralResponse(`This command can only be used by ${ctx.user.username}`);
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
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

			let servers: string[];
			await selected.editParent("What server do you want the command to run on?", {
				components: [
					{
						type: ComponentType.ACTION_ROW,
						components: [
							{
								type: ComponentType.SELECT,
								custom_id: "gserv_server",
								placeholder: "Choose a server.",
								min_values: 1,
								max_values: config.servers.length,
								options: this.serverOptions,
							},
						],
					},
				],
			});
			ctx.registerComponent("gserv_server", async (selected: ComponentContext) => {
				if (selected.user.id !== user.id) {
					selected.send(this.deny(ctx));
					return;
				}
				servers = selected.values;
				selected.editParent(
					`Running ${commands.join(" and ")} on ${servers.join(",")} please wait...`,
					{ components: [] }
				);
				const promises = config.servers
					.filter(
						(srvConfig: { host: string }) =>
							servers.find(srv => srvConfig.host.substr(1, 1) === srv) != undefined
					)
					.map((srvConfig: { host: string; username: string; port: string }) =>
						this.gserv(
							selected,
							srvConfig.host,
							srvConfig.username,
							srvConfig.port,
							commands,
							servers.length === 1
						)
					);
				await Promise.all(promises);
			});
		});
	}
}
