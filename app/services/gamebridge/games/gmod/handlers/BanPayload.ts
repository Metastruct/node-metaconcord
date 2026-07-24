import * as Discord from "discord.js";
import { BanRequest } from "./structures/index.js";
import { PlayerSummary } from "@/app/services/Steam.js";
import { f } from "@/utils.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import SteamID from "steamid";
import requestSchema from "./structures/BanRequest.json" with { type: "json" };

export default class BanPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: BanRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { player, banned, reason, unbanTime, gamemode } = payload.data;
		const { bridge, discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(
			discord.config.threads["bans/unbans"]
		);
		if (!notificationsChannel) return;

		const pastBans = await bridge.container.getService("Bans").getBan(banned.steamId, true);

		const steam = bridge.container.getService("Steam");
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
		embed.addFields(f("Gamemode", gamemode ?? "GLOBAL"));
		if (pastBans?.numbans) {
			embed.addFields(f("Past Bans", pastBans.numbans.toString()));
		}
		embed.addFields(
			f(
				"SteamID",
				`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
			)
		);

		embed.setThumbnail(bannedAvatar ?? null);
		embed.setColor(0xc42144);
		await (notificationsChannel as Discord.TextChannel).send({ embeds: [embed] });
		await (guild.channels.cache.get(discord.config.channels.relay) as Discord.TextChannel).send(
			{
				embeds: [embed],
			}
		);

		const metadata = bridge.container.getService("DiscordMetadata");
		const discordId = await metadata.discordIDfromSteam64(bannedSteamId64);
		if (discordId) {
			await metadata.update(discordId);
		}
	}
}
