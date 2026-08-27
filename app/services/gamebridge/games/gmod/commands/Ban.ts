import * as Discord from "discord.js";
import { DiscordBot } from "@/app/services/discord/index.js";
import { issueBan } from "../banActions.js";
import { parseDuration } from "@/utils.js";
import { SlashCommand } from "@/extensions/discord.js";
import servers from "@/config/gmod.servers.json" with { type: "json" };

const DEFAULT_BAN_LENGTHS = ["1d", "1w", "4w", "6mo", "1y"];
const DEFAULT_BAN_REASONS = ["Mingebag", "Prop Spam", "Harassment"];

const Ban = async (
	nickname: string,
	ctx: Discord.ChatInputCommandInteraction,
	bot: DiscordBot,
	defer = true
) => {
	if (defer) await ctx.deferReply();
	const bridge = bot.bridge;
	if (!bridge) return;
	const selectedServer = ctx.options.getInteger("server") ?? 2;
	const server = bridge.servers.gmod[selectedServer];
	if (!server) {
		await ctx.followUp("That server isn't a GMod server.");
		return;
	}
	const plyName = nickname ?? `???`;
	const steamid = ctx.options.getString("steamid", true);
	const length = Math.round(
		Date.now() / 1000 + parseDuration(ctx.options.getString("length", true))
	);
	const gamemode = ctx.options.getString("gamemode") ?? undefined;
	const reason = ctx.options.getString("reason") ?? "no reason";
	try {
		const ok = await issueBan(
			server,
			{
				steamId: steamid,
				nick: plyName,
				actor: `Discord (${ctx.user.username}|${ctx.user.mention})`,
				reason,
				unbanTime: length,
				gamemode,
			},
			ctx.user.displayName
		);

		if (ok) {
			await ctx.followUp(`Banned \`${plyName} (${steamid})\` expires in: <t:${length}:R>`);
			return;
		}

		await ctx.followUp(
			ok === undefined
				? "GameServer not connected :("
				: `Could not ban \`${plyName}(${steamid})\` expires in: <t:${length}:R>`
		);
	} catch (err) {
		const errMsg = (err as Error)?.message ?? err;
		await ctx.followUp(errMsg);
	}
};

export const SlashBanCommand: SlashCommand = {
	options: {
		name: "ban",
		description: "ban a player in-game",
		default_member_permissions: "0",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "steamid",
				description: "the steamid64 of the player to ban",
				required: true,
				autocomplete: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "length",
				description: "the length of the ban",
				required: true,
				autocomplete: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "reason",
				description: "The reason for the ban",
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "gamemode",
				description: "the gamemode to ban from (sandbox_modded by default)",
				autocomplete: true,
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
		],
	},

	async execute(ctx, bot) {
		const steam = bot.container.getService("Steam");
		const summary = await steam.getUserSummaries(ctx.options.getString("steamid", true));
		if (!summary) {
			await ctx.showModal(<Discord.APIModalInteractionResponseCallbackData>{
				title: "couldn't get nick please enter manually:",
				custom_id: "ban_modal",
				components: [
					{
						type: Discord.ComponentType.ActionRow,
						components: [
							{
								type: Discord.ComponentType.TextInput,
								label: "nickname of the user to ban",
								style: Discord.TextInputStyle.Short,
								placeholder: "Mingebag69",
								custom_id: "nickname_input",
							},
						],
					},
				],
			});
			const response = await ctx.awaitModalSubmit({ time: 60000 }).catch(() => {});
			if (response) {
				await Ban(response.fields.getTextInputValue("nickname_input"), ctx, bot, false);
			}
			return;
		}
		await Ban(summary.personaname, ctx, bot);
	},
	async autocomplete(ctx, bot) {
		const focused = ctx.options.getFocused(true);
		switch (focused.name) {
			case "gamemode": {
				const server = bot.bridge?.servers.gmod[ctx.options.getInteger("server") ?? 2];
				const gamemodes = server?.gamemodes?.map(name => {
					return { name: name, value: name };
				});
				await ctx.respond(gamemodes ?? []);
				break;
			}
			case "steamid": {
				const players =
					bot.bridge?.servers.gmod[ctx.options.getInteger("server") ?? 2]?.status.players;
				if (!players) {
					await ctx.respond([]);
					return;
				}
				await ctx.respond(
					players
						.filter(player => player.steamId64.includes(focused.value))
						.slice(0, 25)
						.map(player => ({
							name: `${player.steamId64} (${player.nick.substring(0, 100)})`,
							value: player.steamId64,
						}))
				);
				break;
			}
			case "length":
				await ctx.respond(
					DEFAULT_BAN_LENGTHS.map(entry => {
						return { name: entry, value: entry };
					})
				);
				break;
			case "reason":
				await ctx.respond(
					DEFAULT_BAN_REASONS.map(entry => {
						return { name: entry, value: entry };
					})
				);
				break;
			default:
				await ctx.respond([]);
		}
	},
};
