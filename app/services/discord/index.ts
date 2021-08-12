import { Container } from "@/app/Container";
import { GatewayServer, SlashCreator } from "slash-create";
import { Service } from "@/app/services";
import { commands } from "./commands";
import Discord, { MessageReaction, TextChannel } from "discord.js";
import config from "@/discord.json";

const DELETE_COLOR: Discord.ColorResolvable = [255, 0, 0];
const EDIT_COLOR: Discord.ColorResolvable = [220, 150, 0];
const EMBED_FIELD_LIMIT = 1024;

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client({
		intents: ["GUILDS", "GUILD_MEMBERS", "GUILD_MESSAGES", "GUILD_MESSAGE_REACTIONS"],
		partials: ["MESSAGE", "CHANNEL", "REACTION"],
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
		for (const slashCmd of commands) {
			creator.registerCommand(new slashCmd(this, creator));
		}

		creator.syncCommands();

		this.discord.on("ready", async () => {
			console.log(`'${this.discord.user.username}' Discord Bot has logged in`);
			await this.setStatus(`Crashing the source engine`);

			setInterval(async () => {
				const newStatus = this.container.getService("Markov").generate();
				await this.setStatus(newStatus);
			}, 1000 * 60 * 10); // change status every 10mins

			// home-made sentry :WeirdChamp:
			process.on("uncaughtException", async (err: Error) => {
				console.error(err);
				if (process.env.NODE_ENV === "development") return;
				try {
					const guild = await this.discord.guilds.resolve(config.guildId)?.fetch();
					const channel = (await guild.channels
						.resolve(config.notificationsChannelId)
						?.fetch()) as TextChannel;

					const embed = new Discord.MessageEmbed({
						hexColor: "#f00",
						description: err.message,
						title: "Unhandled Exception on Metaconcord",
						fields: [{ name: "Stack", value: err.stack.substring(0, 1000) + "..." }],
					});
					await channel.send({
						content: `<@&${config.appDeveloperRole}>`,
						embeds: [embed],
					});
				} catch (oops) {
					console.error(err);
					console.error(oops);
				}
			});
		});

		this.discord.on("messageCreate", async msg => {
			if (msg.partial) {
				try {
					msg = await msg.fetch();
				} catch {
					return;
				}
			}
			await Promise.all([
				this.handleTwitterEmbeds(msg),
				this.handleMarkov(msg),
				this.handleMediaUrls(msg),
			]);
		});

		this.discord.on("messageDelete", async msg => {
			if (msg.partial) {
				try {
					msg = await msg.fetch();
				} catch {
					return;
				}
			}
			if (msg.author.bot) return;

			const logChannel = await this.getTextChannel(config.logChannelId);
			if (!logChannel) return;

			const message =
				msg.content.length > 1
					? msg.content
					: Object.keys(msg.attachments).length > 0
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
			await logChannel.send({ embeds: [embed] });
		});

		this.discord.on("messageUpdate", async (oldMsg, newMsg) => {
			// discord manages embeds by updating user messages
			if (oldMsg.partial) {
				try {
					oldMsg = await oldMsg.fetch();
				} catch {
					return;
				}
			}
			if (oldMsg.content === newMsg.content) return;
			if (oldMsg.author.bot) return;

			const logChannel = await this.getTextChannel(config.logChannelId);
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
			await logChannel.send({ embeds: [embed] });
		});

		this.discord.on("messageReactionAdd", async reaction => {
			if (reaction.partial) {
				try {
					reaction = await reaction.fetch();
				} catch {
					return;
				}
			}
			await this.container
				.getService("Starboard")
				.handleReactionAdded(reaction as MessageReaction);
		});

		this.discord.login(config.token);
	}

	private async getTextChannel(channelId: string): Promise<Discord.TextChannel> {
		return this.discord.channels.cache.get(channelId) as Discord.TextChannel;
	}

	private async setStatus(status: string): Promise<void> {
		if (status.length > 127) status = status.substring(0, 120) + "...";

		this.discord.user.setPresence({
			activities: [
				{
					name: status.trim().substring(0, 100),
					type: "PLAYING",
				},
			],
			status: "online",
		});
	}

	private async handleMarkov(msg: Discord.Message): Promise<void> {
		if (msg.author.bot || msg.guild?.id !== config.guildId) return;

		const chan = msg.channel as Discord.GuildChannel;
		const guild = chan.guild;
		const perms = chan.permissionsFor(guild.roles.everyone);
		if (!perms.has("SEND_MESSAGES", false)) return; // dont get text from channels that are not "public"

		const content = msg.content;
		if (this.container.getService("Motd").isValidMsg(content))
			this.container.getService("Markov").addLine(content);
	}

	private async handleTwitterEmbeds(msg: Discord.Message): Promise<void> {
		const statusUrls = msg.content.match(
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

		const fix = urls.join("\n").substring(0, EMBED_FIELD_LIMIT);
		await msg.channel.send(fix);
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
