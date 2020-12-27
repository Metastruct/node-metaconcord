import { BaseClient } from "./BaseClient";
import { Container } from "../../Container";
import { Data } from "../Data";
import { IService } from "..";
import { ShardClient } from "detritus-client";
import commands from "./commands";
import config from "@/discord.json";

export class DiscordBot implements IService {
	serviceName: "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "!" });

	constructor(data: Data) {
		for (const Command of commands) {
			this.discord.add(new Command(this.discord, data));
		}

		this.discord.run().then((client: ShardClient) => {
			console.log(`'${client.user.name}' Discord Bot has logged in`);

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
