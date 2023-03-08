import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Bans } from "@/app/services/Bans";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import SteamID from "steamid";

export class SlashWhyBanCommand extends SlashCommand {
	private bot: DiscordBot;
	private bans: Bans;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whyban",
			description: "Display in-game ban information",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "query",
					description:
						"use autocomplete or input STEAM_0:1:18717664, [U:1:37435329], 76561197997701057",
					required: true,
					autocomplete: true,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
		const bans = this.bot.container.getService("Bans");
		if (!bans) return;
		this.bans = bans;
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
		const list = await this.bans.getBanList();
		if (!list) return [];
		return list
			.filter(
				function (ban) {
					if (this.limit < 25) {
						const name = ban.name.toLowerCase().includes(ctx.options[ctx.focused]);
						const sid = new SteamID(ban.sid);
						const sid2 = sid
							.getSteam2RenderedID()
							.includes(ctx.options[ctx.focused].toUpperCase());
						const sid3 = sid
							.getSteam3RenderedID()
							.includes(ctx.options[ctx.focused].toUpperCase());
						const sid64 = sid.getSteamID64().includes(ctx.options[ctx.focused]);
						const res = name || sid2 || sid64 || sid3;
						if (!res) return false;
						this.limit++;
						return res;
					}
				},
				{ limit: 0 }
			)
			.map(ban => {
				const namefix = ban.name.replace(/(\u180C|\u0020)/g, ""); // that one ban I swear on me mum is driving me insane
				return {
					name: `${ban.sid} (${namefix.length > 0 ? namefix : "invalid name"})`,
					value: ban.sid,
				};
			});
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const ban = await this.bans.getBan(ctx.options.query);
		if (!ban) return EphemeralResponse("That SteamID has never been banned before.");
		if (!ban.b)
			return EphemeralResponse(
				`\`\`\`ansi\n\u001b[1;33m${
					ban.name
				}\u001b[0;0m is currently \u001b[0;32mnot banned\u001b[0;0m but \u001b[4;36mwas banned${
					ban.numbans && ban.numbans > 1 ? ` ${ban.numbans} times` : ""
				}\u001b[0;0m before.\nLast ban reason:\n\u001b[0;40m${ban.banreason.replace(
					"`",
					"\\`"
				)}\u001b[0;0m\`\`\``
			);

		return EphemeralResponse(
			`\`\`\`ansi\n\u001b[1;33m${
				ban.name
			}\u001b[0;0m is currently \u001b[0;31mbanned\u001b[0;0m for:\n\u001b[0;40m${
				ban.banreason
			}\u001b[0;0m\`\`\`expires: <t:${ban.whenunban}:R>${
				ban.numbans && ban.numbans > 1
					? `\n\`${ban.name}\` was banned \`${ban.numbans} times\` so far`
					: ""
			}`
		);
	}
}
