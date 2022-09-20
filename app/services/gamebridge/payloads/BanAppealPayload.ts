import * as requestSchema from "./structures/BanRequest.json";
import { BanAppealRequest } from "./structures";
import { EmbedFieldData, TextChannel } from "discord.js";
import { GameServer } from "..";
import { PlayerSummary } from "steamapi";
import Discord from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class UnbanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanAppealRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, banReason, appeal, unbanTime } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.notificationsChannelId);
		if (!notificationsChannel) return;

		const steam = bridge.container.getService("Steam");
		let steamId64 = "";
		let bannerName = "";
		let avatar = "";
		try {
			steamId64 = new SteamID(player.steamId).getSteamID64();
			const summary: PlayerSummary = await steam?.getUserSummaries(steamId64);
			if (summary) {
				bannerName = summary.nickname;
				avatar = summary.avatar.large;
			}
		} catch {
			bannerName = player.steamId;
		}

		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const bannedAvatar = await steam?.getUserAvatar(bannedSteamId64);
		const unixTime = parseInt(unbanTime);
		if (!unixTime || isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);

		const fields: EmbedFieldData[] = [
			{ name: "Banned by", value: bannerName, inline: true },
			{ name: "Ban Reason", value: banReason.substring(0, 1900), inline: true },
			{ name: "Ban Expiration", value: `<t:${unixTime}:R>`, inline: true },
			{ name: "Appeal", value: `\`\`\`${appeal.substring(0, 1900).replace("`", "")}\`\`\`` },
			{
				name: "SteamID",
				value: `[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`,
			},
		];
		if (banned.nick) fields.unshift({ name: "Nick", value: banned.nick, inline: true });

		const embed = new Discord.MessageEmbed();
		if (avatar) {
			embed.setThumbnail(avatar);
		}
		embed.setAuthor({
			name: `${banned.nick} appealed a ban`,
			iconURL: bannedAvatar,
			url: `https://steamcommunity.com/profiles/${bannedSteamId64}`,
		});
		embed.addFields(fields);
		(notificationsChannel as TextChannel).send({ embeds: [embed] });
	}
}
