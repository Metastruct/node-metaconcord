import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { SlashDeveloperCommand } from "./DeveloperCommand";
import SteamID from "steamid";

const DEFAULT_BAN_LENGTHS = ["1d", "1w", "4w", "6mo", "1y"];
const DEFAULT_BAN_REASONS = ["Mingebag", "Prop Spam", "Harassment"];

export class SlashBanCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "ban",
			description: "Bans a player in-game",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.INTEGER,
					name: "server",
					description: "The server to run the command on",
					choices: [
						{
							name: "g1",
							value: 1,
						},
						{
							name: "g2",
							value: 2,
						},
						{
							name: "g3",
							value: 3,
						},
					],
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description: "The steamid64 of the banned player",
					required: true,
					autocomplete: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "length",
					description: "The length of the ban",
					required: true,
					autocomplete: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "reason",
					description: "The reason for the ban",
					required: true,
					autocomplete: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
		switch (ctx.focused) {
			case "steamid": {
				const players = await this.getPlayers(ctx.options.server ?? 2);
				if (!players) return [];
				return players
					.filter(
						function (player) {
							if (this.limit < 25) {
								this.limit++;
								const steamID64 = SteamID.fromIndividualAccountID(
									player.accountId
								).getSteamID64();
								return steamID64.includes(ctx.options[ctx.focused]);
							}
						},
						{ limit: 0 }
					)
					.map(player => {
						const steamID64 = SteamID.fromIndividualAccountID(
							player.accountId
						).getSteamID64();
						return {
							name: `${steamID64} (${player.nick})`,
							value: steamID64,
						} as AutocompleteChoice;
					});
			}
			case "length":
				return DEFAULT_BAN_LENGTHS.map(entry => {
					return { name: entry, value: entry } as AutocompleteChoice;
				});
			case "reason":
				return DEFAULT_BAN_REASONS.map(entry => {
					return { name: entry, value: entry } as AutocompleteChoice;
				});
			default:
				return [];
		}
	}

	private parseLength(input: string): number {
		const res = {
			y: 0, // year
			w: 0, // week
			d: 0, // day
			m: 0, // minutes
			s: 0, // seconds
		};

		input = input.trim().toLowerCase().replace(/\s+/g, "");
		for (const match of input.matchAll(/(\d+)([ywdms])/g)) {
			const amount = parseInt(match[1]);
			if (!isNaN(amount) && amount > 0) {
				res[match[2]] += amount;
			}
		}

		let len = 0;
		if (res.y > 0) {
			len += res.y * 31556926;
		}

		if (res.w > 0) {
			len += res.w * 604800;
		}

		if (res.d > 0) {
			len += res.d * 86400;
		}

		if (res.m > 0) {
			len += res.m * 3600;
		}

		if (res.s > 0) {
			len += res.s;
		}

		return len;
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		const steam = this.bot.container.getService("Steam");
		const summary = await steam?.getUserSummaries(ctx.options.steamid);
		if (!summary) {
			await ctx.send("Unable to gather player data");
			return;
		}

		const bridge = this.bot.container.getService("GameBridge");
		if (!bridge) return;
		const server = ctx.options.server ?? 2;
		const plyName = summary.nickname ?? `???`;
		const length = Math.round(Date.now() / 1000 + this.parseLength(ctx.options.length));
		const code =
			`if not banni then return false end ` +
			`local data = banni.Ban("${ctx.options.steamid}", "${plyName}", "Discord (${ctx.user.username}|${ctx.user.mention})", [[${ctx.options.reason}]], ${length}) ` +
			`if istable(data) then return data.b else return data end`;
		try {
			const res = await bridge?.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			const unbanDate = length;
			if (res.data.returns.length > 0 && res.data.returns[0] === "true") {
				await ctx.send(
					`Banned \`${plyName} (${ctx.options.steamid})\` expires in: <t:${unbanDate}:R>`
				);
				return;
			}

			await ctx.send(
				`Could not ban \`${plyName}(${ctx.options.steamid})\` expires in: <t:${unbanDate}:R>`
			);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
