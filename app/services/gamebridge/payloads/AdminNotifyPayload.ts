import * as requestSchema from "./structures/AdminNotifyRequest.json";
import { AdminNotifyRequest } from "./structures";
import { DiscordClient, GameServer } from "..";
import { f } from "@/utils";
import Discord, {
	ButtonBuilder,
	ButtonInteraction,
	ButtonStyle,
	MessageComponentInteraction,
	TextChannel,
} from "discord.js";
import Payload from "./Payload";
import SteamID from "steamid";

export default class AdminNotifyPayload extends Payload {
	protected static requestSchema = requestSchema;
	private static reportCache: {
		[steamId64: string]: number;
	} = {};

	static async initialize(server: GameServer): Promise<void> {
		const discord = server.discord;
		const notificationsChannel = discord.channels.cache.get(
			server.discord.config.threads.reports
		) as TextChannel;
		if (!notificationsChannel) return;
		const steam = server.bridge.container.getService("Steam");

		const filter = (btn: MessageComponentInteraction) => btn.customId.endsWith("_REPORT_KICK");

		const collector = notificationsChannel.createMessageComponentCollector({ filter });

		collector.on("collect", async (ctx: ButtonInteraction) => {
			if (!(await DiscordClient.isAllowed(server, ctx.user))) return;
			await ctx.deferReply();
			try {
				const interactionId64 = new SteamID(
					ctx.customId.replace("_REPORT_KICK", "")
				).getSteamID64();
				const res = await server.bridge.payloads.RconPayload.callLua(
					`local ply = player.GetBySteamID64("${interactionId64}") if not ply then return false end ply:Kick("Kicked by Discord (${ctx.user.username}) for a related report.")`,
					"sv",
					server,
					ctx.user.username
				);

				if (res.data.returns[0] !== "false") {
					const summary = await steam?.getUserSummaries(interactionId64);
					await ctx.followUp({
						content: `${ctx.user.mention} kicked player \`${
							summary ? summary.personaname : "[nickname not found]"
						}\``,
					});
				} else {
					await ctx.followUp({
						content: `${ctx.user.mention}, could not kick player: not on server`,
					});
				}
			} catch (err) {
				await ctx.followUp({
					content: `${ctx.user.mention}, could not kick player: ${err}`,
				});
			}
		});
	}

	static async handle(payload: AdminNotifyRequest, server: GameServer): Promise<void> {
		super.handle(payload, server);

		const { player, reported } = payload.data;
		let { message } = payload.data;
		const { bridge, discord: discordClient } = server;

		if (!discordClient.isReady()) return;

		const guild = discordClient.guilds.cache.get(bridge.config.guildId);
		if (!guild) return;

		const callAdminRole = guild.roles.cache.get(bridge.config.callAdminRoleId);

		const notificationsChannel = guild.channels.cache.get(bridge.config.reportsChannelId);
		if (!notificationsChannel) return;

		const steamId64 = new SteamID(player.steamId).getSteamID64();
		const reportedSteamId64 = new SteamID(reported.steamId).getSteamID64();
		const steam = bridge.container.getService("Steam");
		const avatar = await steam?.getUserAvatar(steamId64);
		const reportedAvatar = await steam?.getUserAvatar(reportedSteamId64);
		if (message.trim().length < 1) message = "No message provided..?";

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${player.nick} reported a player`,
				iconURL: avatar,
				url: `https://steamcommunity.com/profiles/${steamId64}`,
			})
			.addFields(f("Nick", reported.nick))
			.addFields(f("Message", message))
			.addFields(
				f(
					"SteamID",
					`[${reportedSteamId64}](https://steamcommunity.com/profiles/${reportedSteamId64}) (${reported.steamId})`
				)
			)
			.setThumbnail(reportedAvatar)
			.setColor(0xc4af21);

		const sql = bridge.container.getService("SQL");
		if (sql) {
			if (!this.reportCache[reportedSteamId64]) {
				const res = await sql.queryPool(
					`SELECT report_amount FROM playerstats WHERE accountid = ${
						new SteamID(reported.steamId).accountid
					}`
				);
				if (res[0]) {
					this.reportCache[reportedSteamId64] = res[0].report_amount;
				} else {
					this.reportCache[reportedSteamId64] = 0;
				}
			}
			this.reportCache[reportedSteamId64]++;

			if (this.reportCache[reportedSteamId64] > 0) {
				embed.addFields(
					f("Total Report Amount", this.reportCache[reportedSteamId64].toString())
				);
			}
		}
		// You can have a maximum of five ActionRows per message, and five buttons within an ActionRow.
		const row = new Discord.ActionRowBuilder<ButtonBuilder>().addComponents(
			new ButtonBuilder()
				.setStyle(ButtonStyle.Secondary)
				.setCustomId(`${reportedSteamId64}_REPORT_KICK`)
				.setEmoji("🥾")
				.setLabel("KICK Offender"),
			new ButtonBuilder()
				.setStyle(ButtonStyle.Secondary)
				.setCustomId(`${steamId64}_REPORT_KICK`)
				.setEmoji("🥾")
				.setLabel("KICK Reporter")
		);

		try {
			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				embeds: [embed],
				components: [row],
			});
		} catch {
			embed.spliceFields(1, 1);
			// embed.data.fields = embed.data.fields.filter(f => f.name !== "Message");

			await (notificationsChannel as TextChannel).send({
				content: callAdminRole && `<@&${callAdminRole.id}>`,
				files: [
					{
						name: `${player.nick} Report.txt`,
						attachment: Buffer.from(message, "utf8"),
					},
				],
				embeds: [embed],
				components: [row],
			});
		}
	}
}
