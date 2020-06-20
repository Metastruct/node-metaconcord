import {
	CommandClient,
	CommandClientOptions,
	ShardClient,
} from "detritus-client";

export class DiscordClient extends CommandClient {
	public client: ShardClient;

	constructor(token: string | ShardClient, options?: CommandClientOptions) {
		super(token, options);
	}
}
