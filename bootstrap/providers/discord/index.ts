import * as config from "@/discord.config.json";
import { DiscordClient } from "./client";
import { IService } from "../../container";
import { ShardClient } from "detritus-client";

export class DiscordService implements IService {
	public name: "Discord";
	public bot: DiscordClient = new DiscordClient(config.token);

	public constructor() {
		this.bot.run().then((client: ShardClient) => {
			console.log(`${client.user.name} has logged in`);
		});
	}
}

export default (): IService => {
	return new DiscordService();
};
