import { NodeSSH } from "node-ssh";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
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

const gserv = async (
	ctx: Discord.ButtonInteraction,
	host: string,
	username: string,
	port: number,
	commands: string[],
	solo: boolean,
	output: boolean
): Promise<boolean> => {
	const ssh = new NodeSSH();
	try {
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

		const success = !buffer.includes("GSERV FAILED");

		const fileName = `${commands.join("_")}_${host}_${Date.now()}.ansi`;
		let msgContent = host;
		if (!success) msgContent += " FAILED";

		const response: Discord.BaseMessageOptions = {
			content: msgContent,
			files: [{ attachment: Buffer.from(buffer), name: fileName }],
		};

		if (output || success === false) {
			solo ? await ctx.editReply(response) : await ctx.followUp(response);

			if (solo) {
				const msg = await ctx.fetchReply();
				await msg.react(success ? "✅" : "❌");
			}
		} else {
			const msg = await ctx.fetchReply();
			await msg.react(SERVER_EMOJI_MAP[host.slice(1, 2)] ?? "❓");
		}
		return success;
	} catch (err) {
		const msg = host + `\ngserv failed!\`\`\`\n${err}\`\`\``;
		if (solo) {
			await ctx.editReply(msg);
		} else {
			await ctx.followUp(msg);
		}
		return false;
	}
};

export const SlashGservCommand: SlashCommand = {
	options: {
		name: "gserv",
		description: "Gserv from discord",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
	},

	async execute(ctx) {
		const filter = (i: Discord.Interaction) => i.user.id === ctx.user.id;

		const response = await ctx.reply({
			content: "What command do you want to run?",
			components: [
				{
					type: Discord.ComponentType.ActionRow,
					components: [
						{
							type: Discord.ComponentType.StringSelect,
							custom_id: "gserv_command",
							placeholder: "Choose a command.",
							min_values: 1,
							max_values: VALID_GSERV_COMMANDS.length,
							options: VALID_GSERV_COMMANDS.map(
								cmd =>
									<Discord.APISelectMenuOption>{
										label: cmd[0],
										value: cmd[0],
										description: cmd[1],
									}
							),
						},
					],
				},
			],
		});

		try {
			const result = await response.awaitMessageComponent({
				componentType: Discord.ComponentType.StringSelect,
				filter: filter,
				time: 60000,
			});
			const commands = result.values;

			const server = await result.update({
				content: "What server do you want the command to run on?",
				components: [
					{
						type: Discord.ComponentType.ActionRow,
						components: [
							{
								type: Discord.ComponentType.StringSelect,
								custom_id: "gserv_server",
								placeholder: "Choose a server.",
								min_values: 1,
								max_values: config.servers.length,
								options: config.servers.map(
									server =>
										<Discord.APISelectMenuOption>{
											label: server.host.slice(0, 2), // [g1].metastruct.net
											value: server.host.slice(1, 2), // g[1].metastruct.net
											description: server.host, // g1.metastruct.net
										}
								),
							},
						],
					},
				],
			});

			try {
				const result = await server.awaitMessageComponent({
					componentType: Discord.ComponentType.StringSelect,
					filter: filter,
					time: 60000,
				});
				const servers = result.values;

				const output = await result.update({
					content: "Display output?",
					components: [
						{
							type: Discord.ComponentType.ActionRow,
							components: [
								{
									type: Discord.ComponentType.Button,
									custom_id: "gserv_output_n",
									label: "No",
									style: Discord.ButtonStyle.Danger,
								},
								{
									type: Discord.ComponentType.Button,
									custom_id: "gserv_output_y",
									label: "Yes",
									style: Discord.ButtonStyle.Success,
								},
							],
						},
					],
				});

				try {
					const result = await output.awaitMessageComponent({
						componentType: Discord.ComponentType.Button,
						filter: filter,
						time: 60000,
					});
					await result.update({
						content: `Running ${commands.join(" and ")} on ${servers
							.slice()
							.sort()
							.join(", ")} please wait...`,
						components: [],
					});

					await Promise.all(
						config.servers
							.filter(
								(srvConfig: { host: string }) =>
									servers.find(srv => srvConfig.host.slice(1, 2) === srv) !=
									undefined
							)
							.map((srvConfig: { host: string; username: string; port: number }) =>
								gserv(
									result,
									srvConfig.host,
									srvConfig.username,
									srvConfig.port,
									commands,
									servers.length === 1,
									result.customId === "gserv_output_y"
								)
							)
					)
						.then(() => {
							if (servers.length === 1) return;
							result.update(`sent ${commands.join(" and ")} successfully!`);
						})
						.catch(err => result.update(`something went wrong!\`\`\`\n${err}\`\`\``));
				} catch (err) {
					await ctx.editReply(JSON.stringify(err));
				}
			} catch {
				await ctx.deleteReply();
			}
		} catch {
			await ctx.deleteReply();
		}
	},
};
