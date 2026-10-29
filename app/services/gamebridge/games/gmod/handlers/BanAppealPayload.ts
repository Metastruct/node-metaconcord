import * as Discord from "discord.js";
import SteamID from "steamid";

import { f } from "#utils";
import type GmodConnection from "#/app/services/gamebridge/games/gmod/GmodConnection.js";
import { type PlayerSummary } from "#/app/services/Steam.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/BanAppealRequest.json" with { type: "json" };
import { type BanAppealRequest } from "./structures/index.js";

export default class BanAppealPayload extends Payload {
	protected static override requestSchema = requestSchema;

	static override async handle(payload: BanAppealRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { player, banned, banReason, appeal, unbanTime } = payload.data;
		const { bridge, discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(
			discord.config.threads["bans/unbans"]
		);
		if (!notificationsChannel) return;

		const steam = bridge.container.getService("Steam");
		let bannerName = "";
		let avatar = "";
		try {
			const steamId64 = new SteamID(player.steamId).getSteamID64();
			const summary: PlayerSummary | undefined = await steam.getUserSummaries(steamId64);
			if (summary) {
				bannerName = summary.personaname;
				avatar = summary.avatarfull;
			}
		} catch {
			bannerName = player.steamId;
		}

		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const bannedAvatar = await steam.getUserAvatar(bannedSteamId64);
		const unixTime = Math.trunc(Number(unbanTime));
		if (!unixTime || Number.isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);

		const embed = new Discord.EmbedBuilder();
		if (avatar) {
			embed.setThumbnail(avatar);
		}
		embed.setAuthor({
			name: `${banned.nick} appealed a ban`,
			iconURL: bannedAvatar,
			url: `https://steamcommunity.com/profiles/${bannedSteamId64}`,
		});
		if (banned.nick) embed.addFields(f("Nick", banned.nick, true));
		embed.addFields(f("Banned by", bannerName, true));
		embed.addFields(f("Ban Reason", banReason.slice(0, 1900), true));
		embed.addFields(f("Ban Expiration", `<t:${unixTime}:R>`, true));
		embed.addFields(
			f("Appeal", `\`\`\`${appeal.slice(0, 1900).replaceAll("```", "\u{200B}`\u{200B}`\u{200B}`")}\`\`\``)
		);
		embed.addFields(
			f(
				"SteamID",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
			)
		);
		await (notificationsChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
