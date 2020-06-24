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
	public connection: WebSocketConnection;
	public gameBridge: Server;

	constructor(
		token: string | ShardClient,
		connection: WebSocketConnection,
		gameBridge: Server,
		options?: CommandClientOptions
	) {
		super(token, options);

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
			for (const [, attachment] of ctx.message.attachments) {
				content += "\n" + attachment.url;
			}

			const payload = new ChatPayload(this.connection, this.gameBridge);
			payload.send({
				message: {
					user: {
						name: ctx.message.author.name,
					},
					content: content,
				},
			} as ChatResponse);
		});

		return super.run(options);
	}
}
