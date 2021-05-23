import { ChatPayload } from "../payloads";
import Discord from "discord.js";
import GameServer from "../GameServer";

export default class DiscordClient extends Discord.Client {
	gameServer: GameServer;

	constructor(gameServer: GameServer, options?: Discord.ClientOptions) {
		super(options);

		this.gameServer = gameServer;

		this.on("message", ctx => {
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
	}

	public run(token: string): void {
		this.login(token);
	}
}
