import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import axios from "axios";

class MetaBan {
	public sid: string;
	public bannersid: string;
	public unbannersid?: string;
	public b: boolean;
	public banreason: string;
	public unbanreason?: string;
	public whenbanned: number;
	public whenunban: number;
	public whenunbanned?: number;
	public numbans?: number;
	public name: string;
}

export class SlashWhyBanCommand extends SlashCommand {
	private banCache: MetaBan[] = [];
	private lastUpdate = 0;

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
		this.updateCache();
	}

	async updateCache(): Promise<void> {
		const res = await axios.get<Array<MetaBan>>("http://g2.metastruct.net/bans");
		if (res.status === 200) {
			this.banCache = res.data;
		}
		this.lastUpdate = Date.now();
	}

	async getBan(steamid: string): Promise<MetaBan | undefined> {
		if (Date.now() - this.lastUpdate > 5 * 60 * 1000) await this.updateCache();
		const cached = this.banCache.find(ban => ban.sid === steamid);
		if (cached) return cached;
		return undefined;
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
		return this.banCache
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
		const ban = await this.getBan(ctx.options.steamid);
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
