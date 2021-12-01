import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import axios from "axios";

class MetaBan {
	public sid: string;
	public banreason: string;
	public b: boolean;
	public whenunban: number;
	public whenbanned: number;
	public numbans: number;
	public name: string;
}

export class SlashWhyBanCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whyban",
			description: "Gives you the reason as to why you are banned in-game",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "steamid",
					description: "Your steamid in this format STEAM_0:0:000000000",
					required: true,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	private pluralizeString(str: string, quantity: number): string {
		return str + (quantity != 1 ? "s" : "");
	}

	private niceTime(seconds: number): string {
		if (!seconds) return "a few seconds";

		if (seconds < 60) {
			const t = Math.floor(seconds);
			return t + this.pluralizeString(" second", t);
		}

		if (seconds < 60 * 60) {
			const t = Math.floor(seconds / 60);
			return t + this.pluralizeString(" minute", t);
		}

		if (seconds < 60 * 60 * 24) {
			const t = Math.floor(seconds / (60 * 60));
			return t + this.pluralizeString(" hour", t);
		}

		if (seconds < 60 * 60 * 24 * 7) {
			const t = Math.floor(seconds / (60 * 60 * 24));
			return t + this.pluralizeString(" day", t);
		}

		if (seconds < 60 * 60 * 24 * 365) {
			const t = Math.floor(seconds / (60 * 60 * 24 * 7));
			return t + this.pluralizeString(" week", t);
		}

		const t = Math.floor(seconds / (60 * 60 * 24 * 365));
		return t + this.pluralizeString(" year", t);
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const res = await axios.get<Array<MetaBan>>("http://g2.metastruct.net/bans");

		if (res.status === 200) {
			const ban = res.data.find(ban => ban.sid === ctx.options.steamid.toString());
			if (!ban) return EphemeralResponse("That SteamID has never been banned before.");
			if (!ban.b)
				return EphemeralResponse(
					`\`${ban.name}\` is currently not banned but was banned ${ban.numbans} times before.\nLast ban reason: \`${ban.banreason}\``
				);

			return EphemeralResponse(
				`User \`${ban.name}\` is currently banned for: \`${ban.banreason}\`\n expires in: <t:${ban.whenunban}:R>\n\`${ban.name}\` was banned \`${ban.numbans} times\` so far`
			);
		} else {
			return EphemeralResponse("Could not fetch ban data");
		}
	}
}
