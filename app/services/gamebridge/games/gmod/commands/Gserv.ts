import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
// order matters for the menu
const VALID_GSERV_COMMANDS: [string, string][] = [
	["qu rehash", "runs both qu and rehash"],
	["qu", "Quickly updates repositories."],
	["rehash", "Rehashes the server."],
	["merge_repos", "Prepares all repositories for rehash."],
	["rehashskeleton", "Commits skeleton changes. Call rehash afterwards!"],
	["update_repos", "Updates all SVN/Git repositories."],
	["status", "Shows server status."],
];

export const SlashGservCommand: SlashCommand = {
	options: {
		name: "gserv",
		description: "Gserv from discord",
		default_member_permissions: "0",
	},

	async execute(ctx, bot) {
		const bridge = bot.bridge;
		if (!bridge) {
			await ctx.reply(EphemeralResponse("GameBridge is missing :("));
			return;
		}

		await ctx.showModal(<Discord.APIModalInteractionResponseCallbackData>{
			title: "Gserv Command",
			custom_id: "gserv_modal",
			components: [
				{
					type: Discord.ComponentType.Label,
					label: "Command",
					component: {
						type: Discord.ComponentType.StringSelect,
						custom_id: "command",
						placeholder: "Select a command to run",
						options: VALID_GSERV_COMMANDS.map(([name, desc]) => ({
							label: name,
							description: desc,
							value: name,
						})),
					},
				},
				{
					type: Discord.ComponentType.Label,
					label: "Server",
					component: {
						type: Discord.ComponentType.StringSelect,
						custom_id: "server",
						placeholder: "Select a server (runs on all if not selected)",
						options: bridge.servers
							.filter(
								(s): s is GmodConnection =>
									s instanceof GmodConnection && !!s.config.ssh
							)
							.map(s => ({
								label: s.config.name,
								value: String(s.config.id),
							})),
						min_values: 0,
						max_values: 1,
						required: false,
					},
				},
				{
					type: Discord.ComponentType.Label,
					label: "Show output",
					component: {
						type: Discord.ComponentType.Checkbox,
						custom_id: "show_output",
					},
				},
			],
		});

		const modalSubmit = await ctx.awaitModalSubmit({ time: 60000 }).catch(() => {});
		if (!modalSubmit) return;

		const command = modalSubmit.fields.getStringSelectValues("command")[0];
		const serverId = modalSubmit.fields.getStringSelectValues("server")[0];
		const showOutput = modalSubmit.fields.getCheckbox("show_output");

		const channelId = modalSubmit.channelId;
		if (!channelId) {
			await modalSubmit.reply(
				EphemeralResponse("This command can only be used in a server channel")
			);
			return;
		}

		const targetServers = serverId ? [bridge.servers[Number(serverId)]] : bridge.servers;

		const reply = await modalSubmit.deferReply({ withResponse: true });
		const messageID =
			reply.interaction.responseMessageId ?? (await modalSubmit.fetchReply()).id;

		await Promise.all(
			targetServers
				.filter((s): s is GmodConnection => s instanceof GmodConnection && !!s.config.ssh)
				.map(async gameServer => {
					const gSDiscord = gameServer.discord;
					const channel = gSDiscord.channels.cache.get(
						channelId
					) as Discord.GuildTextBasedChannel;
					const message = channel.messages.cache.get(messageID);

					try {
						let buffer = "";

						await gameServer.sshExecCommand("gserv " + command, {
							stream: "stderr",
							onStdout: buff => (buffer += buff),
							onStderr: buff => (buffer += buff),
						});

						const success = !buffer.includes("GSERV FAILED");

						const fileName = `${command}_${gameServer.config.id}_${Date.now()}.ansi`;
						const response = {
							content: !success
								? "<a:ALERTA:843518761160015933> FAILED <a:ALERTA:843518761160015933> "
								: undefined,
							files: [{ attachment: Buffer.from(buffer), name: fileName }],
						};

						if (showOutput || success === false) {
							if (message) {
								message.reply(response);
							} else {
								channel.send(response);
							}
						} else {
							if (message) message.react("👍");
						}
						return success;
					} catch (err) {
						const response = `<a:ALERTA:843518761160015933> failed to run gserv <a:ALERTA:843518761160015933>\n\`\`\`${err}\`\`\``;
						if (message) {
							await message.reply(response);
						} else {
							channel.send(response);
						}
						return false;
					}
				})
		)
			.then(() => {
				modalSubmit.editReply(`sent \`${command}\` successfully!`);
			})
			.catch(err => modalSubmit.editReply(`something went wrong!\`\`\`\n${err}\`\`\``));
	},
};
