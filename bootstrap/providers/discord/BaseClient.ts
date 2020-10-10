import {
	ClusterClient,
	CommandClient,
	CommandClientOptions,
	CommandClientRunOptions,
	ShardClient,
} from "detritus-client";

export class BaseClient extends CommandClient {
	client: ShardClient;

	constructor(token: string | ShardClient, options?: CommandClientOptions) {
		super(token, options);
	}

	async run(options?: CommandClientRunOptions): Promise<ClusterClient | ShardClient> {
		const client = <ShardClient>await super.run(options);

		client.gateway.socket.on("state", ({ state }) => {
			console.log(`${client.user.name} gateway socket changed state to '${state}'`);
		});

		return client;
	}
}
