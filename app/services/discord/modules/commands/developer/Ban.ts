import * as Discord from "discord.js";
import { DiscordBot } from "@/app/services/discord/index.js";
import { SlashCommand } from "@/extensions/discord.js";
import SteamID from "steamid";
import servers from "@/config/gamebridge.servers.json" with { type: "json" };

const DEFAULT_BAN_LENGTHS = ["1d", "1w", "4w", "6mo", "1y"];
const DEFAULT_BAN_REASONS = ["Mingebag", "Prop Spam", "Harassment"];

const parseLength = (input: string): number => {
	const res = {
		y: 0, // year
		mo: 0, // month
		w: 0, // week
		d: 0, // day
		h: 0, // hour
		m: 0, // minutes
		s: 0, // seconds
	};

	input = input.trim().toLowerCase().replace(/\s+/g, "");
	for (const match of input.matchAll(/(\d+)(y|mo|w|d|h|m|s)/g)) {
		const amount = parseInt(match[1]);
		if (!isNaN(amount) && amount > 0) {
			res[match[2]] += amount;
		}
	}

	let len = 0;
	if (res.y > 0) {
		len += res.y * 31556926;
	}

	if (res.mo > 0) {
		len += res.mo * 2628000;
	}

	if (res.w > 0) {
		len += res.w * 604800;
	}

	if (res.d > 0) {
		len += res.d * 86400;
	}

	if (res.h > 0) {
		len += res.h * 3600;
	}

	if (res.m > 0) {
		len += res.m * 60;
	}

	if (res.s > 0) {
		len += res.s;
	}

	return len;
};

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
	const server = bridge.servers[selectedServer];
	const plyName = nickname ?? `???`;
	const steamid = ctx.options.getString("steamid", true);
	const length = Math.round(
		Date.now() / 1000 + parseLength(ctx.options.getString("length", true))
	);
	const gamemode = ctx.options.getString("gamemode");
	const reason = ctx.options.getString("reason") ?? "no reason";
	const code =
		`if not banni then return false end ` +
		`local data = banni.Ban("${steamid}", "${plyName}", "Discord (${ctx.user.username}|${
			ctx.user.mention
		})", [[${reason}]], ${length}, false, ${gamemode ?? "nil"}) ` +
		`if istable(data) then return data.b else return data end`;
	try {
		const res = await server.sendLua(code, "sv", ctx.user.displayName);

		const unbanDate = length;
		if (res && res.data.returns.length > 0 && res.data.returns[0] === "true") {
			await ctx.followUp(`Banned \`${plyName} (${steamid})\` expires in: <t:${unbanDate}:R>`);
			return;
		}

		await ctx.followUp(
			`Could not ban \`${plyName}(${steamid})\` expires in: <t:${unbanDate}:R>`
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
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
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
		const steam = await bot.container.getService("Steam");
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
			const response = await ctx.awaitModalSubmit({ time: 60000 }).catch();
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
				const gamemodes = bot.bridge?.servers[
					ctx.options.getInteger("server") ?? 2
				]?.gamemodes.map(name => {
					return { name: name, value: name };
				});
				await ctx.respond(gamemodes ?? []);
				break;
			}
			case "steamid": {
				const players =
					bot.bridge?.servers[ctx.options.getInteger("server") ?? 2]?.status.players;
				if (!players) {
					await ctx.respond([]);
					return;
				}
				await ctx.respond(
					players
						.filter(
							function (player) {
								if (this.limit < 25) {
									this.limit++;
									const steamID64 = SteamID.fromIndividualAccountID(
										player.accountId
									).getSteamID64();
									return steamID64.includes(focused.value);
								}
							},
							{ limit: 0 }
						)
						.map(player => {
							const steamID64 = SteamID.fromIndividualAccountID(
								player.accountId
							).getSteamID64();
							return {
								name: `${steamID64} (${player.nick.substring(0, 100)})`,
								value: steamID64,
							};
						})
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
