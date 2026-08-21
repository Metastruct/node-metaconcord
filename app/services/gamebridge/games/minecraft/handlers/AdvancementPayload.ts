import * as Discord from "discord.js";
import { AdvancementRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/AdvancementRequest.json" with { type: "json" };

// wording and colors of the vanilla chat announcement per frame type.
// keyed loosely: an unknown frame from a modded advancement falls back to task.
const FRAMES: Record<string, { verb: string; color: number }> = {
	task: { verb: "has made the advancement", color: 0x55ff55 },
	goal: { verb: "has reached the goal", color: 0x55ff55 },
	challenge: { verb: "has completed the challenge", color: 0xaa00aa },
};

export default class AdvancementPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: AdvancementRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { player, title, description, type } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		const guild = discord.guilds.cache.get(discord.config.bot.primaryGuildId);
		if (!guild) return;

		const relayChannel = guild.channels.cache.get(discord.config.channels.minecraftRelay);
		if (!relayChannel) return;

		const frame = FRAMES[type] ?? FRAMES.task;

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} ${frame.verb}`,
				iconURL: `https://mc-heads.net/avatar/${player.uuid}`,
				url: `https://namemc.com/profile/${player.uuid}`,
			})
			.setTitle(title.substring(0, 256))
			.setColor(frame.color);
		if (description) embed.setDescription(description.substring(0, 4096));
		await (relayChannel as Discord.TextChannel).send({ embeds: [embed] });
	}
}
