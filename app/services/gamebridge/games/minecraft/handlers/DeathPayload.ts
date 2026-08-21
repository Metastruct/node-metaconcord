import * as Discord from "discord.js";
import { DeathRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/DeathRequest.json" with { type: "json" };

export default class DeathPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: DeathRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { player, message } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const relayChannel = guild.channels.cache.get(discord.config.channels.minecraftRelay);
		if (!relayChannel) return;

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: message.substring(0, 256),
				iconURL: `https://mc-heads.net/avatar/${player.uuid}`,
				url: `https://namemc.com/profile/${player.uuid}`,
			})
			// grey, so it stays distinct from JoinLeavePayload's green/red pair
			.setColor(0x808080);
		await (relayChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
