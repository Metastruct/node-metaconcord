import { ChatPayload } from "../payloads";
import Discord, { ButtonInteraction, User } from "discord.js";
import GameServer from "../GameServer";
import SteamID from "steamid";
import config from "@/discord.json";

export default class DiscordClient extends Discord.Client {
	gameServer: GameServer;

	constructor(gameServer: GameServer, options?: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;
		const steam = gameServer.bridge.container.getService("Steam");

		this.on("messageCreate", ctx => {
			if (ctx.channel.id != this.gameServer.bridge.config.relayChannelId) return;
			if (ctx.author.bot || !ctx.author.client) return;

			let content = ctx.content;
			content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
				const extension = !!animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
			});
			for (const [, attachment] of ctx.attachments) {
				content += "\n" + attachment.url;
			}

			ChatPayload.send(
				{
					user: {
						nick: ctx.member.user.username,
						color: ctx.member.displayColor,
					},
					content,
				},
				this.gameServer
			);
		});

		this.on("interactionCreate", async (interactionCtx: ButtonInteraction) => {
			if (!interactionCtx.isButton() || !interactionCtx.customId.endsWith("_REPORT_KICK"))
				return;
			await interactionCtx.defer();
			if (!(await this.isAllowed(gameServer.discord, interactionCtx.user))) return;

			try {
				const interactionId64 = new SteamID(
					interactionCtx.customId.replace("_REPORT_KICK", "")
				).getSteamID64();
				const res = await gameServer.bridge.payloads.RconPayload.callLua(
					`local ply = player.GetBySteamID64("${interactionId64}") if not ply then return false end ply:Kick("Kicked by Discord (${interactionCtx.user.username}) for a related report.")`,
					"sv",
					this.gameServer,
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
		});
	}
	private async isAllowed(bot: DiscordClient, user: User): Promise<boolean> {
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

	public run(token: string): void {
		this.login(token);
	}
}
