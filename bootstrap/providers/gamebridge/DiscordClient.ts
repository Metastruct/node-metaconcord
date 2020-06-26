import { BaseClient } from "../discord/BaseClient";
import { ChatPayload } from "./payloads";
import { ChatResponse } from "./payloads/structures";
import {
	ClusterClient,
	CommandClientOptions,
	CommandClientRunOptions,
	ShardClient,
} from "detritus-client";
import { Server } from "./index";
import { connection as WebSocketConnection } from "websocket";

export default class DiscordClient extends BaseClient {
	public client: ShardClient;
	public config: any;
	public connection: WebSocketConnection;
	public gameBridge: Server;

	constructor(
		config: any,
		connection: WebSocketConnection,
		gameBridge: Server,
		options?: CommandClientOptions
	) {
		super(config.discordToken, options);

		this.config = config;
		this.connection = connection;
		this.gameBridge = gameBridge;
	}

	async run(
		options?: CommandClientRunOptions
	): Promise<ClusterClient | ShardClient> {
		this.client.on("messageCreate", ctx => {
			if (ctx.message.channelId != this.gameBridge.config.relayChannelId)
				return;
			if (ctx.message.author.bot || !ctx.message.author.client) return;

			let content = ctx.message.content;
			content = content.replace(
				/<(a?):([^\s:<>]*):(\d+)>/g,
				(_, animated, emoji, id) => {
					const extension = !!animated ? "gif" : "png";
					return `https://media.discordapp.net/emojis/${id}.${extension}?v=1&size=64 `;
				}
			);
			for (const [, attachment] of ctx.message.attachments) {
				content += "\n" + attachment.url;
			}

			const payload = new ChatPayload(this.connection, this.gameBridge);
			payload.send({
				message: {
					user: {
						name: ctx.message.member.name,
					},
					content: content,
				},
			} as ChatResponse);
		});

		return super.run(options);
	}
}
