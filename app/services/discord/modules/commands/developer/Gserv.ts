import { EphemeralResponse } from "..";
import { GameServer } from "@/app/services/gamebridge";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
import servers from "@/config/gamebridge.servers.json";

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
	gameServer: GameServer,
	commands: string[],
	solo: boolean,
	output: boolean
): Promise<boolean> => {
	try {
		let buffer = "";

		await gameServer.sshExec("gserv", commands, {
			stream: "stderr",
			onStdout: buff => (buffer += buff),
			onStderr: buff => (buffer += buff),
		});

		const success = !buffer.includes("GSERV FAILED");

		const fileName = `${commands.join("_")}_${gameServer.config.id}_${Date.now()}.ansi`;
		let msgContent = gameServer.config.name;
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
			await msg.react(SERVER_EMOJI_MAP[gameServer.config.id] ?? "❓");
		}
		return success;
	} catch (err) {
		const msg = gameServer.config.name + `\ngserv failed!\`\`\`\n${err}\`\`\``;
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

	async execute(ctx, bot) {
		const filter = (i: Discord.Interaction) => i.user.id === ctx.user.id;
		const bridge = bot.bridge;
		if (!bridge) {
			await ctx.reply(EphemeralResponse("GameBridge is missing :("));
			console.error(`SlashGserv: GameBridge missing?`, ctx);
			return;
		}

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
								max_values: servers.filter(s => !!s.ssh).length,
								options: servers
									.filter(s => !!s.ssh)
									.map(
										server =>
											<Discord.APISelectMenuOption>{
												label: server.ssh?.host.slice(0, 2), // [g1].metastruct.net
												value: server.id.toString(), // g[1].metastruct.net
												description: server.name, // g1.metastruct.net
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
				const selectedServers = result.values;

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
						content: `Running ${commands.join(" and ")} on ${selectedServers
							.slice()
							.sort()
							.join(", ")} please wait...`,
						components: [],
					});

					await Promise.all(
						bridge.servers
							.filter(s => selectedServers.indexOf(s.config.id.toString()))
							.map(gameServer =>
								gserv(
									result,
									gameServer,
									commands,
									selectedServers.length === 1,
									result.customId === "gserv_output_y"
								)
							)
					)
						.then(() => {
							if (selectedServers.length === 1) return;
							result.update(`sent ${commands.join(" and ")} successfully!`);
						})
						.catch(err => result.update(`something went wrong!\`\`\`\n${err}\`\`\``));
				} catch (err) {
					console.error(err);
					await ctx.editReply(JSON.stringify(err));
				}
			} catch (err) {
				console.error(err);
				await ctx.deleteReply();
			}
		} catch (err) {
			console.error(err);
			await ctx.deleteReply();
		}
	},
};
