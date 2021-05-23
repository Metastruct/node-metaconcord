import {
	CommandData,
	CommandMember,
	GatewayServer,
	GuildInteractionRequestData,
	InteractionType,
	Member,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import { ShardClient } from "detritus-client";
import { SlashMarkovCommand } from "./commands/MarkovCommand";
import { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import BaseClient from "./BaseClient";
import MuteCommand, { SlashMuteCommand } from "./commands/mute/MuteCommand";
import config from "@/discord.json";

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: BaseClient = new BaseClient(config.token, { prefix: "/" });

	constructor(container: Container) {
		super(container);

		(async () => {
			this.discord.add(new MuteCommand(this));
			const client = (await this.discord.run()) as ShardClient;
			console.log(`'${client.user.name}' Discord Bot has logged in`);

			client.gateway.setPresence({
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
				new GatewayServer(handler => {
					client.on("interactionCreate", ev => {
						const member: unknown = new Member(ev.member.toJSON(), creator);
						handler({
							channel_id: ev.channelId,
							data: ev.data as unknown as CommandData,
							guild_id: ev.guildId,
							id: ev.id,
							member: member as CommandMember,
							token: ev.token,
							type: ev.type as unknown as InteractionType,
							version: ev.version as 1,
						} as GuildInteractionRequestData);
					});
				})
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
