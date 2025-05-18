import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import servers from "@/config/gamebridge.servers.json" with { type: "json" };

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
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "command",
				description: "the command to run",
				choices: VALID_GSERV_COMMANDS.map(c => {
					return { name: c[0], value: c[0] };
				}),
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.Integer,
				name: "server",
				description: "The server to run the command on",
				choices: servers
					.filter(s => !!s.ssh)
					.map(s => {
						return { name: s.name, value: s.id };
					}),
			},
			{
				type: Discord.ApplicationCommandOptionType.Boolean,
				name: "show_output",
				description: "show gserv output",
			},
		],
	},

	async execute(ctx, bot) {
		const bridge = bot.bridge;
		if (!bridge) {
			await ctx.reply(EphemeralResponse("GameBridge is missing :("));
			console.error(`SlashGserv: GameBridge missing?`, ctx);
			return;
		}
		const selectedServer = ctx.options.getInteger("server");
		const servers = selectedServer ? [bridge.servers[selectedServer]] : bridge.servers;
		const command = ctx.options.getString("command", true);
		const showOutput = ctx.options.getBoolean("show_output") ?? false;

		const reply = await ctx.deferReply({ withResponse: true });

		await Promise.all(
			servers.map(async gameServer => {
				const gSDiscord = gameServer.discord;
				try {
					let buffer = "";

					await gameServer.sshExec("gserv", [command], {
						stream: "stderr",
						onStdout: buff => (buffer += buff),
						onStderr: buff => (buffer += buff),
					});

					const success = !buffer.includes("GSERV FAILED");

					const fileName = `${command}_${gameServer.config.id}_${Date.now()}.ansi`;

					if (showOutput || success === false) {
						gSDiscord.rest.post(Discord.Routes.channelMessages(ctx.channelId), {
							body: {
								content: !success
									? "<a:ALERTA:843518761160015933> FAILED <a:ALERTA:843518761160015933> "
									: undefined,
								message_reference: reply.interaction.responseMessageId
									? {
											type: 0,
											message_id: reply.interaction.responseMessageId,
										}
									: undefined,
							},
							files: [{ data: Buffer.from(buffer), name: fileName }],
						});
					} else {
						if (reply.interaction.responseMessageId) {
							gSDiscord.rest.put(
								Discord.Routes.channelMessageReaction(
									ctx.channelId,
									reply.interaction.responseMessageId,
									"👍"
								)
							);
						}
					}
					return success;
				} catch (err) {
					const msg = gameServer.config.name + `\ngserv failed!\`\`\`\n${err}\`\`\``;
					gSDiscord.rest.post(Discord.Routes.channelMessages(ctx.channelId), {
						body: {
							content: `<a:ALERTA:843518761160015933> failed to run gerv <a:ALERTA:843518761160015933>\n\`\`\`${err}\`\`\``,

							message_reference: {
								type: 0,
								message_id: reply.interaction.responseMessageId,
							},
						},
					});
					return false;
				}
			})
		)
			.then(() => {
				ctx.editReply(`sent \`${command}\` successfully!`);
			})
			.catch(err => ctx.editReply(`something went wrong!\`\`\`\n${err}\`\`\``));
	},
};
