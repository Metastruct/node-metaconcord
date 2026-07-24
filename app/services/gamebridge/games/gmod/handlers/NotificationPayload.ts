import * as Discord from "discord.js";
import { NotificationResponse } from "./structures/index.js";
import GmodConnection from "@/app/services/gamebridge/games/gmod/GmodConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/NotificationResponse.json" with { type: "json" };

export default class NotificationPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: NotificationResponse, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { title, message, color } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const notificationsChannel = guild.channels.cache.get(
			discord.config.channels.notifications
		);
		if (!notificationsChannel) return;

		const embed = new Discord.EmbedBuilder()
			.setTitle(title.substring(0, 256))
			.setDescription(message.substring(0, 4096))
			.setColor(color ?? 0xc4af21);
		await (notificationsChannel as Discord.TextChannel).send({
			embeds: [embed],
		});
	}
}
