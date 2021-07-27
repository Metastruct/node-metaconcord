import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashBanCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "ban",
			description: "Bans a player in-game",
			deferEphemeral: true,
			options: [
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description:
						"The steamid of the banned player in this format STEAM_0:0:000000000",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "length",
					description: "The length of the ban",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "reason",
					description: "The reason for the ban",
					required: true,
				},
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
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
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

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();

		if (!(await this.isAllowed(ctx.user))) {
			return EphemeralResponse(`You are not allowed to use this command.`);
		}

		const steam = this.bot.container.getService("Steam");
		const summary = await steam.getUserSummaries(steam.steamIDToSteamID64(ctx.options.steamid));
		if (!summary) {
			await ctx.send("Unable to gather player data");
			return;
		}

		const bridge = this.bot.container.getService("GameBridge");
		const server = (ctx.options.server as number) ?? 2;
		const plyName = summary.personaname ?? `???`;
		const length = Date.now() / 1000 + this.parseLength(ctx.options.length);
		const code = `if not banni then return false end return banni.Ban("${ctx.options.steamid}", "${plyName}", nil, [[${ctx.options.reason}]], ${length}).b`;
		try {
			const res = await bridge.payloads.RconPayload.callLua(
				code,
				"sv",
				bridge.servers[server],
				ctx.member?.displayName ?? "???"
			);

			const unbanDate = new Date(length * 1000);
			if (res.data.returns.length > 0 && res.data.returns[0] === "true") {
				await ctx.send(
					`Banned \`${plyName}(${
						ctx.options.steamid
					})\` until \`${unbanDate.toUTCString()}\``
				);
				return;
			}

			await ctx.send(
				`Could not ban \`${plyName}(${
					ctx.options.steamid
				})\` until \`${unbanDate.toUTCString()}\``
			);
		} catch (err) {
			const errMsg = (err as Error)?.message ?? err;
			await ctx.send(errMsg);
		}
	}
}
