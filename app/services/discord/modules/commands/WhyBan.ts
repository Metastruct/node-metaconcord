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

export class SlashWhyBanCommand extends SlashCommand {
	private bot: DiscordBot;
	private bans: Bans;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whyban",
			description: "Display in-game ban information",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description: "Your steamid in this format STEAM_0:0:000000000",
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
						this.limit++;
						return ban.sid.includes(ctx.options[ctx.focused]);
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
		const ban = await this.bans.getBan(ctx.options.steamid);
		if (!ban) return EphemeralResponse("That SteamID has never been banned before.");
		if (!ban.b)
			return EphemeralResponse(
				`\`${ban.name}\` is currently not banned but was banned ${
					ban.numbans && ban.numbans > 1 ? `\`${ban.numbans} times\`` : ""
				} before.\nLast ban reason:\n\`\`\`${ban.banreason.replace("`", "\\`")}\`\`\``
			);

		return EphemeralResponse(
			`User \`${ban.name}\` is currently banned for: \`${ban.banreason}\`\nexpires: <t:${
				ban.whenunban
			}:R>${
				ban.numbans && ban.numbans > 1
					? `\n\`${ban.name}\` was banned \`${ban.numbans} times\` so far`
					: ""
			}`
		);
	}
}
