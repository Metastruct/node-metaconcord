import { Container } from "@/app/Container";
import { GatewayServer, SlashCreator } from "slash-create";
import { HelpCommand, SlashHelpCommand } from "./commands/HelpCommand";
import { MarkovCommand, SlashMarkovCommand } from "./commands/MarkovCommand";
import { Service } from "@/app/services";
import { ShardClient } from "detritus-client";
import BaseClient from "./BaseClient";
import MuteCommand, { SlashMuteCommand } from "./commands/mute/MuteCommand";
import UnmuteCommand, { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import WhyMuteCommand, { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import config from "@/discord.json";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "/" });

	constructor(container: Container) {
		super(container);

		this.discord.add(new MarkovCommand(this));
		this.discord.add(new WhyMuteCommand(this));
		this.discord.add(new MuteCommand(this));
		this.discord.add(new UnmuteCommand(this));
		this.discord.add(new HelpCommand(this));

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
			});

			creator
				.withServer(
					new GatewayServer(handler => {
						client.gateway.on("packet", packet => {
							const data: any = JSON.parse(packet.d);
							if (data.type === "APPLICATION_COMMAND") {
								handler(data);
							}
						});
					})
				)
				.registerCommands([
					new SlashMarkovCommand(creator),
					new SlashWhyMuteCommand(creator),
					new SlashMuteCommand(creator),
					new SlashUnmuteCommand(creator),
					new SlashHelpCommand(creator),
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
