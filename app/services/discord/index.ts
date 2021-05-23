import { Container } from "@/app/Container";
import { GatewayServer, SlashCommand, SlashCreator } from "slash-create";
import { Service } from "@/app/services";
import { SlashMarkovCommand } from "./commands/MarkovCommand";
import { SlashMuteCommand } from "./commands/mute/MuteCommand";
import { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import Discord, { WSEventType } from "discord.js";
import config from "@/discord.json";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client();

	constructor(container: Container) {
		super(container);

		(async () => {
			//this.discord.add(new MuteCommand(this));
			await this.discord.login(config.token);
			console.log(`'${this.discord.user.username}' Discord Bot has logged in`);

			this.discord.user.setPresence({
				activity: {
					name: `!help`,
					type: 2,
				},
				status: "online",
			});

			const creator = new SlashCreator({
				applicationID: config.applicationId,
				publicKey: config.publicKey,
				token: config.token,
			});

			creator.withServer(
				new GatewayServer(handler =>
					this.discord.ws.on("INTERACTION_CREATE" as WSEventType, handler)
				)
			);

			const cmds: Array<SlashCommand> = [
				new SlashMarkovCommand(container, creator),
				new SlashWhyMuteCommand(this, creator),
				new SlashMuteCommand(creator),
				new SlashUnmuteCommand(this, creator),
			];

			for (const slashCmd of cmds) {
				if (creator.commands.some(cmd => cmd.commandName === slashCmd.commandName))
					continue;

				creator.registerCommand(slashCmd);
			}

			creator.syncCommands();
		})();

		this.discord.on("messageCreate", ev => {
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
