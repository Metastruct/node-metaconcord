import * as Discord from "discord.js";
import { BanAppealRequest } from "./structures/index.js";
import { PlayerSummary } from "@/app/services/Steam.js";
import { f } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import SteamID from "steamid";
import requestSchema from "./structures/BanAppealRequest.json" assert { type: "json" };

export default class UnbanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanAppealRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, banReason, appeal, unbanTime } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.ready) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.banUnbanChannelId);
		if (!notificationsChannel) return;

		const steam = await bridge.container.getService("Steam");
		let steamId64 = "";
		let bannerName = "";
		let avatar = "";
		try {
			steamId64 = new SteamID(player.steamId).getSteamID64();
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
		const unixTime = parseInt(unbanTime);
		if (!unixTime || isNaN(unixTime))
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
		embed.addFields(f("Ban Reason", banReason.substring(0, 1900), true));
		embed.addFields(f("Ban Expiration", `<t:${unixTime}:R>`, true));
		embed.addFields(
			f("Appeal", `\`\`\`${appeal.substring(0, 1900).replaceAll("```", "​`​`​`")}\`\`\``)
		);
		embed.addFields(
			f(
				"SteamID",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
			)
		);
		(notificationsChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
