import { Container } from "@/app/Container";
import { GatewayServer, SlashCommand, SlashCreator } from "slash-create";
import { Service } from "@/app/services";
import { SlashBanCommand } from "./commands/developer/BanCommand";
import { SlashCustomRoleCommand } from "./commands/CustomRoleCommand";
import { SlashGservCommand } from "./commands/developer/GservCommand";
import { SlashKickCommand } from "./commands/developer/KickCommand";
import { SlashLuaCommand } from "./commands/developer/LuaCommand";
import { SlashMarkovCommand } from "./commands/MarkovCommand";
import { SlashMuteCommand } from "./commands/mute/MuteCommand";
import { SlashRconCommand } from "./commands/developer/RconCommand";
import { SlashRefreshLuaCommand } from "./commands/developer/RefreshLuaCommand";
import { SlashUnmuteCommand } from "./commands/mute/UnmuteCommand";
import { SlashVaccinatedCommand } from "./commands/VaccinationCommand";
import { SlashWhyBanCommand } from "./commands/WhyBanCommand";
import { SlashWhyMuteCommand } from "./commands/mute/WhyMuteCommand";
import Discord from "discord.js";
import config from "@/discord.json";

const DELETE_COLOR: Discord.ColorResolvable = [255, 0, 0];
const EDIT_COLOR: Discord.ColorResolvable = [220, 150, 0];
const EMBED_FIELD_LIMIT = 1999;

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client({
		fetchAllMembers: false,
		shardCount: 1,
	});

	constructor(container: Container) {
		super(container);

		const creator = new SlashCreator({
			applicationID: config.applicationId,
			publicKey: config.publicKey,
			token: config.token,
		});
		// Emergency mode lolol
		creator.on("error", console.error);
		creator.on("commandError", console.error);
		creator.on("warn", console.warn);
		// creator.on("debug", console.log);
		// creator.on("ping", console.log);
		// creator.on("rawREST", console.log);
		// creator.on("unknownInteraction", console.log);
		// creator.on("unverifiedRequest", console.log);
		// creator.on("synced", console.log);
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
			new SlashCustomRoleCommand(this, creator),
			new SlashVaccinatedCommand(this, creator),
			new SlashLuaCommand(this, creator),
			new SlashRconCommand(this, creator),
			new SlashRefreshLuaCommand(this, creator),
			new SlashWhyBanCommand(this, creator),
			new SlashBanCommand(this, creator),
			new SlashKickCommand(this, creator),
		];
		for (const slashCmd of cmds) {
			creator.registerCommand(slashCmd);
		}

		creator.syncCommands();

		this.discord.on("ready", async () => {
			console.log(`'${this.discord.user.username}' Discord Bot has logged in`);
			await this.setStatus(`Crashing the source engine`);

			setInterval(async () => {
				const newStatus = this.container.getService("Markov").generate();
				await this.setStatus(newStatus);
			}, 1000 * 60 * 10); // change status every 10mins
		});

		this.discord.on("message", async ev => {
			await Promise.all([
				this.handleTwitterEmbeds(ev as Discord.Message),
				this.handleMarkov(ev),
				this.handleMediaUrls(ev),
			]);
		});

		this.discord.on("messageDelete", async msg => {
			if (msg.author.bot) return;

			const logChannel = await this.getGuildTextChannel(config.logChannelId);
			if (!logChannel) return;

			const message =
				msg.content.length > 1
					? msg.content
					: msg.attachments
					? `[${msg.attachments.first().name}]`
					: "???";

			const embed = new Discord.MessageEmbed()
				.setAuthor(msg.author.username, msg.author.avatarURL())
				.setColor(DELETE_COLOR)
				.addField("Channel", `<#${msg.channel.id}>`)
				.addField("Mention", msg.author.mention)
				.addField("Message", message.substring(0, EMBED_FIELD_LIMIT), true)
				.setFooter("Message Deleted")
				.setTimestamp(Date.now());
			await logChannel.send(embed);
		});

		this.discord.on("messageUpdate", async (oldMsg, newMsg) => {
			// discord manages embeds by updating user messages
			if (oldMsg.content === newMsg.content) return;
			if (oldMsg.author.bot) return;

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
			await logChannel.send(embed);
		});

		this.discord.ws.on("MESSAGE_REACTION_ADD", async reaction => {
			const channel = await this.getGuildTextChannel(reaction.channel_id);
			const msg = await channel.messages.fetch(reaction.message_id);
			const msgReaction = await new Discord.MessageReaction(
				this.discord,
				reaction,
				msg
			).fetch();
			await this.container.getService("Starboard").handleReactionAdded(msgReaction);
		});

		this.discord.login(config.token);
	}

	private async getGuildTextChannel(channelId: string): Promise<Discord.TextChannel> {
		const guild = await this.discord.guilds.resolve(config.guildId)?.fetch();
		if (!guild) return;

		const chan = (await guild.channels.resolve(channelId)?.fetch()) as Discord.TextChannel;
		return chan;
	}

	private async setStatus(status: string): Promise<void> {
		if (status.length > 127) status = status.substring(0, 120) + "...";

		await this.discord.user.setPresence({
			activity: {
				name: status.trim().substring(0, 100),
				type: "PLAYING",
			},
			status: "online",
		});
	}

	private async handleMarkov(ev: Discord.Message): Promise<void> {
		if (ev.author.bot || ev.guild?.id !== config.guildId) return;

		const chan = (await ev.channel.fetch()) as Discord.GuildChannel;
		const guild = await chan.guild.fetch();
		const roles = await guild.roles.fetch();
		const perms = chan.permissionsFor(roles.everyone);
		if (!perms.has("SEND_MESSAGES", false)) return; // dont get text from channels that are not "public"

		const content = ev.content;
		if (this.container.getService("Motd").isValidMsg(content))
			this.container.getService("Markov").addLine(content);
	}

	private async handleTwitterEmbeds(ev: Discord.Message): Promise<void> {
		const statusUrls = ev.content.match(
			/https?:\/\/twitter\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/g
		);
		if (!statusUrls) return;

		let urls: Array<string> = [];
		for (const statusUrl of statusUrls) {
			const mediaUrls = await this.container
				.getService("Twitter")
				.getStatusMediaURLs(statusUrl);
			urls = urls.concat(mediaUrls);
		}

		if (urls.length === 0) return;

		const msg = urls.join("\n").substring(0, EMBED_FIELD_LIMIT);
		await ev.channel.send(msg);
	}
	private async handleMediaUrls(ev: Discord.Message): Promise<void> {
		// https://media.discordapp.net/attachments/769875739817410562/867369588014448650/video.mp4
		// https://cdn.discordapp.com/attachments/769875739817410562/867369588014448650/video.mp4

		const mediaUrls = ev.content.matchAll(
			/https?:\/\/media.discordapp.net\/attachments(\/\d+\/\d+\/\S+\.(webm|mp4|mov))/g
		);

		let urls: Array<string> = [];
		for (const mediaUrl of mediaUrls) {
			urls = urls.concat(`https://cdn.discordapp.com/attachments${mediaUrl[1]}`);
		}
		if (urls.length === 0) return;

		ev.reply(urls.join("\n"));
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
