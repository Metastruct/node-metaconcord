import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import { ShardClient } from "detritus-client";
import { GatewayServer, SlashCreator } from "slash-create";
import BaseClient from "./BaseClient";
import commands from "./commands";
import config from "@/discord.json";
import path from "path";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "/" });

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

			const socket = this.discord.client.gateway.socket;
			const creator = new SlashCreator({
				applicationID: config.applicationId,
				token: config.token,
			});

			creator.withServer(new GatewayServer((handler) => socket.on("INTERACTION_CREATE", handler)));
			creator
				// Registers all of your commands in the ./commands/ directory
				.registerCommandsIn(path.join(__dirname, "commands"))
				// This will sync commands to Discord, it must be called after commands are loaded.
				// This also returns itself for more chaining capabilities.
				.syncCommands();
		});

		this.discord.client.on("messageCreate", ev => {
			const author = ev.message.author;
			if (ev.message.guildId !== config.guildId || author.bot || author.isWebhook) return;

			const content = ev.message.content;
			if (this.container.getService("Motd").isValidMsg(content))
				this.container.getService("Markov").addLine(content);
		});
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
