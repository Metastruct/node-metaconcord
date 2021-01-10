import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import { ShardClient } from "detritus-client";
import BaseClient from "./BaseClient";
import commands from "./commands";
import config from "@/discord.json";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "!" });

	constructor(container: Container) {
		super(container);

		for (const command of commands) {
			this.discord.add(new command(this));
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

export default (container: Container): Service => {
	return new DiscordBot(container);
};
