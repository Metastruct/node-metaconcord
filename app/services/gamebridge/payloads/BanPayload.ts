import * as requestSchema from "./structures/BanRequest.json";
import { BanRequest } from "./structures";
import { GameServer } from "..";
import { TextChannel } from "discord.js";
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

		const notificationsChannel = guild.channels.cache.get(bridge.config.notificationsChannelId);
		if (!notificationsChannel) return;

		const steam = bridge.container.getService("Steam");
		let steamId64 = "";
		let bannerName = "";
		let avatar = undefined;
		try {
			steamId64 = new SteamID(player.steamId).getSteamID64();
			avatar = await steam?.getUserAvatar(steamId64);
		} catch {
			bannerName = player.steamId;
		}

		const bannedSteamId64 = new SteamID(banned.steamId).getSteamID64();
		const bannedAvatar = await steam?.getUserAvatar(bannedSteamId64);
		const unixTime = parseInt(unbanTime);
		if (!unixTime || isNaN(unixTime))
			throw new Error(`Unban time is not a number? Supplied time: ${unbanTime}`);

		const embed = new Discord.MessageEmbed();
		if (avatar) {
			embed.setAuthor({
				name: `${player.nick || "<-"} banned a player`,
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
				embed.setTitle(`${name} banned a player`);
				embed.addField("Mention", mention);
			} else {
				embed.setTitle(`${bannerName} banned a player`);
			}
		}

		if (banned.nick) embed.addField("Nick", banned.nick, true);
		embed.addField("Expiration", `<t:${unixTime}:R>`, true);
		embed.addField("Reason", reason.substring(0, 1900));
		embed.addField(
			"SteamID",
			`[${bannedSteamId64}](https://steamcommunity.com/profiles/${bannedSteamId64}) (${banned.steamId})`
		);
		embed.setThumbnail(bannedAvatar);
		embed.setColor(0xc42144);
		(notificationsChannel as TextChannel).send({ embeds: [embed] });
	}
}
