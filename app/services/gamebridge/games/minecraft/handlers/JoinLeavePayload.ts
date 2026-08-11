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

		const avatar = `https://mc-heads.net/avatar/${player.uuid}`;

		if (spawned) {
			server.status.players = server.status.players
				.filter(p => p.steamId64 !== player.uuid)
				.concat({
					steamId64: player.uuid,
					avatar,
					ip: "",
					isAdmin: false,
					isBanned: false,
					nick: player.nick,
				});
		} else {
			server.status.players = server.status.players.filter(p => p.steamId64 !== player.uuid);
		}
		const playerCount = server.status.players.length;
		server.setPresence("online", {
			activity: {
				name: `${playerCount} player${playerCount != 1 ? "s" : ""}`,
				type: Discord.ActivityType.Watching,
			},
		});

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
