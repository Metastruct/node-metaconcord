import * as requestSchema from "./structures/JoinLeaveRequest.json";
import { GameServer } from "..";
import { JoinLeaveRequest } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";

export default class JoinLeavePayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: JoinLeaveRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reason, spawned } = payload.data;
		const { bridge, discord } = server;

		if (!discord.isReady()) return;

		const guild = discord.guilds.cache.get(discord.config.guildId);
		if (!guild) return;

		const relayChannel = guild.channels.cache.get(bridge.config.relayChannelId);
		if (!relayChannel) return;

		const avatar = await bridge.container.getService("Steam")?.getUserAvatar(player.steamId64);
		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} has ${spawned ? "spawned" : "left"}`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${player.steamId64}`,
			})
			.setColor(spawned ? 0x4bb543 : 0xb54343);
		if (reason) embed.setDescription(`Reason: ${reason}`);
		(relayChannel as TextChannel).send({ embeds: [embed] });
	}
}
