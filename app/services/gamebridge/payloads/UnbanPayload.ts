import * as Discord from "discord.js";
import { PlayerSummary } from "@/app/services/Steam.js";
import { UnbanRequest } from "./structures/index.js";
import { f } from "@/utils.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import Payload from "./Payload.js";
import SteamID from "steamid";
import requestSchema from "./structures/UnbanRequest.json" assert { type: "json" };

export default class UnbanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: UnbanRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, banReason, unbanReason, banTime } = payload.data;
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
		const unixTime = parseInt(banTime);
		if (!unixTime || isNaN(unixTime))
			throw new Error(`ban time is not a number? Supplied time: ${banTime}`);

		const embed = new Discord.EmbedBuilder();
		if (avatar) {
			embed.setAuthor({
				name: `${player.nick} unbanned a player`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${steamId64}`,
			});
		} else {
			if (bannerName.startsWith("Discord")) {
				const chunks = bannerName
					.replaceAll("Discord ", "")
					.replaceAll(")", "")
					.replaceAll("(", "")
					.split("|");

				const name = chunks[0].trim();
				const mention = chunks[1].trim();
				embed.setTitle(`${name} unbanned a player`);
				embed.addFields(f("Mention", mention));
			} else {
				embed.setTitle(`${bannerName} unbanned a player`);
			}
		}

		if (banned.nick) embed.addFields(f("Nick", banned.nick, true));
		embed.addFields(f("Expiration", `<t:${unixTime}:R>`, true));
		embed.addFields(f("Ban Reason", banReason.substring(0, 1900)));
		embed.addFields(f("Unban Reason", unbanReason.substring(0, 1900)));
		embed.addFields(
			f(
				"SteamID",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
			)
		);
		embed.setThumbnail(bannedAvatar);
		embed.setColor("Green");
		(notificationsChannel as Discord.TextChannel).send({ embeds: [embed] });
		(guild.channels.cache.get(bridge.config.relayChannelId) as Discord.TextChannel).send({
			embeds: [embed],
		});
	}
}
