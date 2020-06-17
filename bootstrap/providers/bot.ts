import { IService, Container } from "@/bootstrap/container";
import { CommandClient } from "detritus-client";

export class BotService implements IService {
	public name;
	public client: CommandClient = new CommandClient(process.env.DISCORD_TOKEN);

	constructor() {
		this.client.add({
			// Example
			name: "ping",
			run: (context, args) => {
				return context.reply("pong!");
			},
		});
	}

	async run(): Promise<void> {
		const shardClient = await this.client.run();
		console.log(
			`Client has loaded with a shard count of ${shardClient.shardCount}`
		);
	}
}

export default (container: Container): IService => {
	const bot = new BotService();
	bot.run();
	return bot;
};
