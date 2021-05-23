import { Container } from "@/app/Container";
import { ExpressServer, SlashCreator } from "slash-create";
import { HelpCommand, SlashHelpCommand } from "./commands/HelpCommand";
import { MarkovCommand, SlashMarkovCommand } from "./commands/MarkovCommand";
import { Service } from "@/app/services";
import { ShardClient } from "detritus-client";
import BaseClient from "./BaseClient";
import MuteCommand, { SlashMuteCommand } from "./commands/mute/MuteCommand";
import UnmuteCommand, { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import WhyMuteCommand, { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import config from "@/discord.json";
import webappConfig from "@/webapp.json";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "/" });

	constructor(container: Container) {
		super(container);

		this.discord.add(MarkovCommand);
		this.discord.add(WhyMuteCommand);
		this.discord.add(MuteCommand);
		this.discord.add(UnmuteCommand);
		this.discord.add(HelpCommand);

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

			const creator = new SlashCreator({
				applicationID: config.applicationId,
				publicKey: config.publicKey,
				token: config.token,
				serverPort: webappConfig.port,
				serverHost: webappConfig.host,
			});

			creator
				.withServer(
					new ExpressServer(container.getService("WebApp").app, {
						alreadyListening: true,
					})
				)
				.registerCommands([
					SlashMarkovCommand,
					SlashWhyMuteCommand,
					SlashMuteCommand,
					SlashUnmuteCommand,
					SlashHelpCommand,
				])
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
