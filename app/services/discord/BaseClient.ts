import {
	ClusterClient,
	CommandClient,
	CommandClientOptions,
	CommandClientRunOptions,
	ShardClient,
} from "detritus-client";

export default class BaseClient extends CommandClient {
	client: ShardClient;

	constructor(token: string | ShardClient, options?: CommandClientOptions) {
		super(token, options);
	}

	async run(options?: CommandClientRunOptions): Promise<ClusterClient | ShardClient> {
		const client = (await super.run(options)) as ShardClient;

		client.gateway.reconnectMax = Infinity; // Let's hope this works lmao

		return client;
	}
}
