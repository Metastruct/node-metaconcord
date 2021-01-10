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

		client.gateway.socket.on("state", ({ state }) => {
			console.log(`${client.user.name} gateway socket changed state to '${state}'`);
		});

		return client;
	}
}
