import { BaseClient } from "../discord/BaseClient";
import { ChatPayload } from "./payloads";
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
	}

	async run(
		options?: CommandClientRunOptions
	): Promise<ClusterClient | ShardClient> {
		this.client.on("messageCreate", ctx => {
			const payload = new ChatPayload(this.connection, this.gameBridge);
		});

		return super.run(options);
	}
}
