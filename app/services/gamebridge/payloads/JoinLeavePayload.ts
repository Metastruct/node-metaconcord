import * as requestSchema from "./structures/JoinLeaveRequest.json";
import { GameServer } from "..";
import { JoinLeaveRequest } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";
import config from "@/discord.json";

export default class JoinLeavePayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: JoinLeaveRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reason, spawned } = payload.data;
		const { bridge, discord: discordClient } = server;

		const guild = await discordClient.guilds.resolve(config.guildId)?.fetch();
		if (!guild) return;

		const relayChannel = await guild.channels.resolve(bridge.config.relayChannelId)?.fetch();
		if (!relayChannel) return;

		const avatar = await bridge.container.getService("Steam").getUserAvatar(player.steamId64);
		const embed = new Discord.MessageEmbed()
			.setAuthor(
				`${player.nick} has ${spawned ? "spawned" : "left"}`,
				avatar,
				`https://steamcommunity.com/profiles/${player.steamId64}`
			)
			.setColor(spawned ? 0x4bb543 : 0xb54343);
		if (reason) embed.setDescription(`Reason: ${reason}`);
		(relayChannel as TextChannel).send({ embeds: [embed] });
	}
}
