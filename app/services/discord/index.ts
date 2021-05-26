import { Container } from "@/app/Container";
import { GatewayServer, SlashCommand, SlashCreator } from "slash-create";
import { Service } from "@/app/services";
import { SlashGservCommand } from "./commands/GservCommand";
import { SlashMarkovCommand } from "./commands/MarkovCommand";
import { SlashMuteCommand } from "./commands/mute/MuteCommand";
import { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import Discord from "discord.js";
import config from "@/discord.json";

const DELETE_COLOR: Discord.ColorResolvable = [255, 0, 0];
const EDIT_COLOR: Discord.ColorResolvable = [220, 150, 0];
const EMBED_FIELD_LIMIT = 1999;

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
				this.discord.ws.on("INTERACTION_CREATE" as Discord.WSEventType, handler)
			)
		);
		const cmds: Array<SlashCommand> = [
			new SlashMarkovCommand(this, creator),
			new SlashMuteCommand(this, creator),
			new SlashUnmuteCommand(this, creator),
			new SlashWhyMuteCommand(this, creator),
			new SlashGservCommand(this, creator),
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

		this.discord.on("message", ev => {
			if (ev.author.bot || ev.guild?.id !== config.guildId) return;

			const chan = ev.channel as Discord.GuildChannel;
			const perms = chan.permissionsFor(chan.guild.roles.everyone);
			if (!perms.has("SEND_MESSAGES")) return; // dont get text from channels that are not "public"

			const content = ev.content;
			if (this.container.getService("Motd").isValidMsg(content))
				this.container.getService("Markov").addLine(content);
		});

		this.discord.on("messageDelete", async msg => {
			const logChannel = await this.getGuildTextChannel(config.logChannelId);
			if (!logChannel) return;

			const embed = new Discord.MessageEmbed()
				.setAuthor(msg.author.username, msg.author.avatarURL())
				.setColor(DELETE_COLOR)
				.addField("Channel", `<#${msg.channel.id}>`)
				.addField("Mention", msg.author.mention)
				.addField("Message", msg.content.substring(0, EMBED_FIELD_LIMIT), true)
				.setFooter("Message Deleted")
				.setTimestamp(Date.now());
			logChannel.send(embed);
		});

		this.discord.on("messageUpdate", async (oldMsg, newMsg) => {
			const logChannel = await this.getGuildTextChannel(config.logChannelId);
			if (!logChannel) return;

			const embed = new Discord.MessageEmbed()
				.setAuthor(oldMsg.author.username, oldMsg.author.avatarURL())
				.setColor(EDIT_COLOR)
				.addField("Channel", `<#${oldMsg.channel.id}>`)
				.addField("Mention", oldMsg.author.mention)
				.addField("New Message", newMsg.content.substring(0, EMBED_FIELD_LIMIT), true)
				.addField("Old Message", oldMsg.content.substring(0, EMBED_FIELD_LIMIT), true)
				.setFooter("Message Edited")
				.setTimestamp(newMsg.editedTimestamp);
			logChannel.send(embed);
		});
	}

	private async getGuildTextChannel(channelId: string): Promise<Discord.TextChannel> {
		const guild = await this.discord.guilds.resolve(config.guildId)?.fetch();
		if (!guild) return;

		const chan = (await guild.channels.resolve(channelId)?.fetch()) as Discord.TextChannel;
		return chan;
	}

	private setStatus(status: string): void {
		if (status.length > 127) status = status.substring(0, 120) + "...";

		this.discord.user.setPresence({
			activity: {
				name: status.trim().substring(0, 100),
				type: "PLAYING",
			},
			status: "online",
		});
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
