import * as Discord from "discord.js";
import { JoinLeaveRequest } from "./structures/index.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/JoinLeaveRequest.json" with { type: "json" };

export default class JoinLeavePayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: JoinLeaveRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { player, reason, spawned } = payload.data;
		const { bridge, discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const relayChannel = guild.channels.cache.get(discord.config.channels.relay);
		if (!relayChannel) return;

		const avatar = await bridge.container.getService("Steam").getUserAvatar(player.steamId64);
		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} has ${spawned ? "spawned" : "left"}`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${player.steamId64}`,
			})
			.setColor(spawned ? 0x4bb543 : 0xb54343);
		if (reason) embed.setDescription(`Reason: ${reason}`);
		await (relayChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
