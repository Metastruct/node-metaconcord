import { ChatPayload } from "../payloads";
import { ChatResponse } from "../payloads/structures";
import Discord, { ButtonInteraction, TextChannel, User } from "discord.js";
import GameServer from "../GameServer";
import SteamID from "steamid";
import config from "@/config/discord.json";

export default class DiscordClient extends Discord.Client {
	gameServer: GameServer;
	config = config;

	constructor(gameServer: GameServer, options?: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;
		const steam = gameServer.bridge.container.getService("Steam");

		this.on("messageCreate", async ctx => {
			if (!this.isReady()) return;
			if (ctx.channel.id != this.gameServer.bridge.config.relayChannelId) return;
			if (ctx.author.bot || !ctx.author.client) return;

			if (ctx.partial) {
				ctx = await ctx.fetch();
			}

			let content = ctx.content;
			content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
				const extension = !!animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
			});
			content = content.replace(
				/<#([\d]+)>/g,
				(_, id) => `#${(ctx.client.channels.cache.get(id) as TextChannel).name}`
			);
			for (const [, attachment] of ctx.attachments) {
				content += "\n" + attachment.url;
			}
			let reply: Discord.Message;
			if (ctx.reference) {
				reply = await ctx.fetchReference();
			}

			let nickname = ctx.author.username;
			try {
				const author = await ctx.guild.members.fetch(ctx.author.id);
				if (author && author.nickname && author.nickname.length > 0) {
					nickname = author.nickname;
				}
			} catch {} // dont care

			const avatar = ctx.author.avatarURL({ dynamic: true });

			const payload: ChatResponse = {
				user: {
					id: ctx.author.id,
					nick: nickname,
					color: ctx.member.displayColor,
					avatar_url: avatar ?? ctx.author.defaultAvatarURL,
				},
				msgID: ctx.id,
				content: content,
			};

			if (reply) {
				payload.replied_message = {
					msgID: reply.id,
					content: reply.content,
					ingame: reply.author.discriminator === "0000",
				};
			}

			ChatPayload.send(payload, this.gameServer);
		});

		this.on("interactionCreate", async (interactionCtx: ButtonInteraction) => {
			if (!interactionCtx.isButton() || !interactionCtx.customId.endsWith("_REPORT_KICK"))
				return;
			await interactionCtx.deferReply();
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

			await interactionCtx.update({});
		});

		this.on("warn", console.log);
		this.on("debug", console.log);
	}

	private async isAllowed(bot: DiscordClient, user: User): Promise<boolean> {
		try {
			const guild = bot.guilds.cache.get(config.guildId);
			if (!guild) return false;

			const member = await guild.members.fetch(user.id);
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
