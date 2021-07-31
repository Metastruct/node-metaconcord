import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { DiscordClient, GameBridge, GameServer } from "..";
import { Steam } from "../..";
import Discord, { TextChannel, User } from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";
import config from "@/discord.json";
import fs from "fs";
import path from "path";

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static interactionHandler = false;

	private static async isAllowed(bot: DiscordClient, user: User): Promise<boolean> {
		try {
			const guild = await bot.guilds.resolve(config.guildId)?.fetch();
			if (!guild) return false;

			const member = await guild.members.resolve(user.id)?.fetch();
			if (!member) return false;

			return member.roles.cache.has(config.developerRoleId);
		} catch {
			return false;
		}
	}

	private static async onInteractionCreate(
		discordClient: DiscordClient,
		server: GameServer,
		bridge: GameBridge,
		steam: Steam,
		interactionCtx: Discord.ButtonInteraction
	): Promise<any> {
		if (!interactionCtx.isButton() || !interactionCtx.customId.endsWith("_REPORT_KICK")) return;
		await interactionCtx.defer();
		if (!(await this.isAllowed(discordClient, interactionCtx.user))) return;

		try {
			const interactionId64 = new SteamID(
				interactionCtx.customId.replace("_REPORT_KICK", "")
			).getSteamID64();
			const res = await bridge.payloads.RconPayload.callLua(
				`local ply = player.GetBySteamID64("${interactionId64}") if not ply then return false end ply:Kick("Discord (${interactionCtx.user.username}) for a related report.")`,
				"sv",
				server,
				interactionCtx.user.username
			);

			if (res.data.returns[0] !== "false") {
				const summary = await steam.getUserSummaries(interactionId64);
				await interactionCtx.editReply({
					content: `${interactionCtx.user.mention} kicked player \`${summary.nickname}\``,
				});
			} else {
				await interactionCtx.editReply({
					content: `${interactionCtx.user.mention}, could not kick player: not on server`,
				});
			}
		} catch (err) {
			await interactionCtx.editReply({
				content: `${interactionCtx.user.mention}, could not kick player: ${err}`,
			});
		}
	}

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const { bridge, discord: discordClient } = server;

		const guild = await discordClient.guilds.resolve(bridge.config.guildId)?.fetch();
		if (!guild) return;

		const callAdminRole = guild.roles.resolve(bridge.config.callAdminRoleId);

		const notificationsChannel = await guild.channels.fetch(
			bridge.config.notificationsChannelId
		);
		if (!notificationsChannel) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reported.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam.getUserAvatar(steamId64);
		const reportedAvatar = await steam.getUserAvatar(reportedSteamId64);
		if (message.trim().length < 1) message = "No message provided..?";

		const embed = new Discord.MessageEmbed()
			.setAuthor(
				`${player.nick} reported a player`,
				avatar,
				`https://steamcommunity.com/profiles/${steamId64}`
			)
			.addField("Nick", reported.nick)
			.addField(
				"SteamID",
				`[${reportedSteamId64}](https://steamcommunity.com/profiles/${reportedSteamId64}) (${reported.steamId})`
			)
			.setThumbnail(reportedAvatar)
			.setColor(0xc4af21);
		// You can have a maximum of five ActionRows per message, and five buttons within an ActionRow.
		const row = new Discord.MessageActionRow().addComponents([
			{
				label: "Reporter",
				type: 2,
				style: "SECONDARY",
				emoji: "🥾",
				customId: `${steamId64}_REPORT_KICK`,
			},
			{
				label: "Offender",
				type: 2,
				style: "SECONDARY",
				emoji: "🥾",
				customId: `${reportedSteamId64}_REPORT_KICK`,
			},
		]);

		if (!this.interactionHandler) {
			discordClient.on(
				"interactionCreate",
				async iCtx =>
					await this.onInteractionCreate(
						discordClient,
						server,
						bridge,
						steam,
						iCtx as Discord.ButtonInteraction
					)
			);

			this.interactionHandler = true;
		}

		if (message.length > 200) {
			const reportPath = path.resolve(
				`${Date.now()}_${player.nick}_report.txt`.toLocaleLowerCase()
			);
			await new Promise<void>((resolve, reject) =>
				fs.writeFile(reportPath, message, err => (err ? reject(err.message) : resolve()))
			);

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				files: [reportPath],
				embeds: [embed],
				components: [row],
			});

			await new Promise<void>((resolve, reject) =>
				fs.unlink(reportPath, err => (err ? reject(err.message) : resolve()))
			);
		} else {
			embed.addField("Message", message);

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				embeds: [embed],
				components: [row],
			});
		}
	}
}
