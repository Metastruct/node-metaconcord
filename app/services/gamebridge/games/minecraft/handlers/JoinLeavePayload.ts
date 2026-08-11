import * as Discord from "discord.js";
import { JoinLeaveRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/JoinLeaveRequest.json" with { type: "json" };

export default class JoinLeavePayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: JoinLeaveRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { player, reason, spawned } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const relayChannel = guild.channels.cache.get(discord.config.channels.minecraftRelay);
		if (!relayChannel) return;

		// player tracking, presence and the status embed are StatusPayload's job
		const avatar = `https://mc-heads.net/avatar/${player.uuid}`;

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} has ${spawned ? "joined" : "left"}`,
				iconURL: avatar,
				url: `https://namemc.com/profile/${player.uuid}`,
			})
			.setColor(spawned ? 0x4bb543 : 0xb54343);
		if (reason) embed.setDescription(`Reason: ${reason}`);
		await (relayChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
