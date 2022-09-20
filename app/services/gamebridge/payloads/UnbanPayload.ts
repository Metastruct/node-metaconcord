import * as requestSchema from "./structures/BanRequest.json";
import { EmbedFieldData, TextChannel } from "discord.js";
import { GameServer } from "..";
import { PlayerSummary } from "steamapi";
import { UnbanRequest } from "./structures";
import Discord from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class UnbanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: UnbanRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, banReason, unbanReason, unbanTime } = payload.data;
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

		const fields: EmbedFieldData[] = [];

		const embed = new Discord.MessageEmbed();
		if (avatar) {
			embed.setAuthor({
				name: `${player.nick} unbanned a player`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${steamId64}`,
			});
		} else {
			if (bannerName.startsWith("Discord")) {
				const chunks = bannerName
					.replace("Discord ", "")
					.replace(")", "")
					.replace("(", "")
					.split("|");

				const name = chunks[0].trim();
				const mention = chunks[1].trim();
				embed.setTitle(`${name} unbanned a player`);
				fields.push({ name: "Mention", value: mention });
			} else {
				embed.setTitle(`${bannerName} unbanned a player`);
			}
		}

		if (banned.nick) fields.push({ name: "Nick", value: banned.nick, inline: true });
		fields.push(
			{ name: "Expiration", value: `<t:${unixTime}:R>`, inline: true },
			{ name: "Ban Reason", value: banReason.substring(0, 1900) },
			{ name: "Unban Reason", value: unbanReason.substring(0, 1900) },
			{
				name: "SteamID",
				value: `[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`,
			}
		);
		if (bannedAvatar) embed.setThumbnail(bannedAvatar);
		embed.setColor("GREEN");
		(notificationsChannel as TextChannel).send({ embeds: [embed] });
	}
}
