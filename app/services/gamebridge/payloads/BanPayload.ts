import * as requestSchema from "./structures/BanRequest.json";
import { BanRequest } from "./structures";
import { GameServer } from "..";
import { PlayerSummary } from "../../Steam";
import { TextChannel } from "discord.js";
import { f } from "@/utils";
import Discord from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class BanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, banned, reason, unbanTime } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.banUnbanChannelId);
		if (!notificationsChannel) return;

		const steam = bridge.container.getService("Steam");
		let steamId64 = "";
		let bannerName = "";
		let avatar = "";
		try {
			steamId64 = new SteamID(player.steamId).getSteamID64();
			const summary: PlayerSummary | undefined = await steam?.getUserSummaries(steamId64);
			if (summary) {
				bannerName = summary.personaname;
				avatar = summary.avatarfull;
			}
		} catch {
			bannerName = player.steamId;
		}

		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const bannedAvatar = await steam?.getUserAvatar(bannedSteamId64);
		const unixTime = parseInt(unbanTime);
		if (!unixTime || isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);

		const embed = new Discord.EmbedBuilder();
		if (avatar) {
			embed.setAuthor({
				name: `${player.nick} banned a player`,
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
				embed.setTitle(`${name} banned a player`);
				embed.addFields(f("Mention", mention));
			} else {
				embed.setTitle(`${bannerName} banned a player`);
			}
		}

		if (banned.nick) embed.addFields(f("Nick", banned.nick, true));
		embed.addFields(f("Expiration", `<t:${unixTime}:R>`, true));
		embed.addFields(f("Reason", reason.substring(0, 1900)));
		embed.addFields(
			f(
				"SteamID",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
			)
		);
		embed.setThumbnail(bannedAvatar);
		embed.setColor(0xc42144);
		(notificationsChannel as TextChannel).send({ embeds: [embed] });
		(guild.channels.cache.get(bridge.config.relayChannelId) as TextChannel).send({
			embeds: [embed],
		});

		const metadata = bridge.container.getService("DiscordMetadata");
		if (metadata) {
			const discordId = await metadata.discordIDfromSteam64(bannedSteamId64);
			if (discordId) {
				metadata.update(discordId);
			}
		}
	}
}
