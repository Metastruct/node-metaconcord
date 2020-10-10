import * as config from "@/discord.config.json";
import { BaseClient } from "./BaseClient";
import { Container } from "../../Container";
import { Data } from "../Data";
import { IService } from "../../providers";
import { ShardClient } from "detritus-client";
import commands from "./commands";

export class DiscordBot implements IService {
	name: "DiscordBot";
	config = config;
	bot: BaseClient = new BaseClient(config.token, { prefix: "!" });

	constructor(data: Data) {
		for (const Command of commands) {
			this.bot.add(new Command(this.bot, data));
		}

		this.bot.run().then((client: ShardClient) => {
			console.log(`${client.user.name} has logged in`);

			const status = {
				activity: {
					name: `!help`,
					type: 2,
				},
				status: "online",
			};
			client.gateway.setPresence(status);
		});
	}
}

export default (container: Container): IService => {
	return new DiscordBot(container.getService(Data));
};
