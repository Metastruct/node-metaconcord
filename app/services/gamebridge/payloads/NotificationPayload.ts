import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { GameServer } from "..";
import { NotificationResponse } from "./structures";
import Discord, { TextChannel } from "discord.js";
import Payload from "./Payload";

export default class NotificationPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: NotificationResponse, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { title, message, color } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(bridge.config.notificationsChannelId);
		if (!notificationsChannel) return;

		const embed = new Discord.EmbedBuilder()
			.setTitle(title.substring(0, 256))
			.setDescription(message.substring(0, 4096))
			.setColor(color ?? 0xc4af21);
		await (notificationsChannel as TextChannel).send({
			embeds: [embed],
		});
	}
}
