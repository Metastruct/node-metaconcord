import { BaseClient } from "../../discord/BaseClient";
import { ChatPayload } from "../payloads";
import { ChatResponse } from "../payloads/structures";
import {
	ClusterClient,
	CommandClientOptions,
	CommandClientRunOptions,
	ShardClient,
} from "detritus-client";
import { GameBridge } from "../index";
import { connection as WebSocketConnection } from "websocket";

export default class DiscordClient extends BaseClient {
	client: ShardClient;
	config: any;
	connection: WebSocketConnection;
	gameBridge: GameBridge;

	constructor(
		config: any,
		connection: WebSocketConnection,
		gameBridge: GameBridge,
		options?: CommandClientOptions
	) {
		super(config.discordToken, options);

		this.config = config;
		this.connection = connection;
		this.gameBridge = gameBridge;

		this.client.on("messageCreate", ctx => {
			if (ctx.message.channelId != this.gameBridge.config.relayChannelId) return;
			if (ctx.message.author.bot || !ctx.message.author.client) return;

			let content = ctx.message.convertContent({
				guildSpecific: true,
			});
			content = content.replace(/<(a?):([^\s:<>]*):(\d+)>/g, (_, animated, emoji, id) => {
				const extension = !!animated ? "gif" : "png";
				return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
			});
			for (const [, attachment] of ctx.message.attachments) {
				content += "\n" + attachment.url;
			}

			const payload = new ChatPayload(this);
			payload.send({
				message: {
					user: {
						name: ctx.message.member.name,
						color: ctx.message.member.color,
					},
					content,
				},
			} as ChatResponse);
		});
	}
}
