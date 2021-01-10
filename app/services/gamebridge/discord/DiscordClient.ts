import { ChatPayload } from "../payloads";
import { CommandClientOptions, ShardClient } from "detritus-client";
import BaseClient from "@/app/services/discord/BaseClient";
import GameServer from "../GameServer";

export default class DiscordClient extends BaseClient {
	client: ShardClient;
	gameServer: GameServer;

	constructor(gameServer: GameServer, options?: CommandClientOptions) {
		super(gameServer.config.discordToken, options);

		this.gameServer = gameServer;

		this.client.on("messageCreate", ctx => {
			if (ctx.message.channelId != this.gameServer.bridge.config.relayChannelId) return;
			if (ctx.message.author.bot || !ctx.message.author.client) return;

			let content = ctx.message.convertContent({
				guildSpecific: true,
			});
			content = content.replace(/<(a?):[^\s:<>]*:(\d+)>/g, (_, animated, id) => {
				const extension = !!animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
			});
			for (const [, attachment] of ctx.message.attachments) {
				content += "\n" + attachment.url;
			}

			ChatPayload.send(
				{
					user: {
						nick: ctx.message.member.name,
						color: ctx.message.member.color,
					},
					content,
				},
				this.gameServer
			);
		});
	}
}
