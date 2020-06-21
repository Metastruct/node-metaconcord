import * as config from "@/discord.config.json";
import { BaseClient } from "./BaseClient";
import { IService } from "../../Container";
import { ShardClient } from "detritus-client";

export class DiscordBot implements IService {
	public name: "Discord";
	public bot: BaseClient = new BaseClient(config.token);

	public constructor() {
		this.bot.run().then((client: ShardClient) => {
			console.log(`${client.user.name} has logged in`);
		});
	}
}

export default (): IService => {
	return new DiscordBot();
};
