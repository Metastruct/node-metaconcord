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

		const creator = new SlashCreator({
			applicationID: config.applicationId,
			publicKey: config.publicKey,
			token: config.token,
		});
		// Emergency mode lolol
		// creator.on("error", console.log);
		// creator.on("commandError", console.log);
		// creator.on("warn", console.log);
		// creator.on("debug", console.log);
		// creator.on("ping", console.log);
		// creator.on("rawREST", console.log);
		// creator.on("unknownInteraction", console.log);
		// creator.on("unverifiedRequest", console.log);
		// creator.on("synced", console.log);
		// creator.on("ping", console.log);
		creator.withServer(
			new GatewayServer(handler =>
				this.discord.ws.on("INTERACTION_CREATE" as WSEventType, handler)
			)
		);
		const cmds: Array<SlashCommand> = [
			new SlashMarkovCommand(this, creator),
			new SlashMuteCommand(this, creator),
			new SlashUnmuteCommand(this, creator),
			new SlashWhyMuteCommand(this, creator),
		];
		for (const slashCmd of cmds) {
			creator.registerCommand(slashCmd);
		}
		creator.syncCommands();

		this.discord.login(config.token).then(async () => {
			console.log(`'${this.discord.user.username}' Discord Bot has logged in`);
			this.setStatus(`Crashing the source engine`);

			setInterval(() => {
				const newStatus = this.container.getService("Markov").generate();
				this.setStatus(newStatus);
			}, 1000 * 60 * 10); // change status every 10mins
		});

		this.discord.on("messageCreate", ev => {
			const author = ev.message.author;
			if (ev.message.guildId !== config.guildId || author.bot || author.isWebhook) return;

			const content = ev.message.content;
			if (this.container.getService("Motd").isValidMsg(content))
				this.container.getService("Markov").addLine(content);
		});
	}

	private setStatus(status: string): void {
		if (status.length > 127) status = status.substring(0, 120) + "...";

		this.discord.user.setPresence({
			activity: {
				name: status.trim().substring(0, 100),
				type: "CUSTOM_STATUS",
			},
			status: "online",
		});
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
