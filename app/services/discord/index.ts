import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Discord from "discord.js";
import config from "@/config/discord.json";
import modules from "./modules";

export const EMBED_FIELD_LIMIT = 1024;

const IGNORED_CODES = ["ECONNRESET", "ETIMEDOUT", "ECONNREFUSED"];
export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client({
		intents: ["GUILDS", "GUILD_MEMBERS", "GUILD_MESSAGES", "GUILD_MESSAGE_REACTIONS"],
		partials: ["MESSAGE", "CHANNEL", "REACTION"],
	});

	constructor(container: Container) {
		super(container);

		this.discord.on("ready", async () => {
			console.log(`'${this.discord.user.username}' Discord Bot has logged in`);
			await this.setStatus(`Crashing the source engine`);

			setInterval(() => {
				try {
					const newStatus = this.container.getService("Markov").generate();
					this.setStatus(newStatus);
				} catch {} // who cares
			}, 1000 * 60 * 10); // change status every 10mins

			// home-made sentry :WeirdChamp:
			if (process.env.NODE_ENV !== "development") {
				process.on("uncaughtException", async (err: any) => {
					// Unknown inconsequential error, either from our websocket or Discord.js's
					if (IGNORED_CODES.includes(err.code)) return;

					try {
						const channel = await this.getTextChannel(config.notificationsChannelId);

						const embed = new Discord.MessageEmbed({
							hexColor: "#f00",
							description: err.message,
							title: "Unhandled Exception on Metaconcord",
							fields: [
								{ name: "Stack", value: err.stack.substring(0, 1000) + "..." },
								...(err.code ? [{ name: "Code", value: err.code }] : []),
							],
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
			}
		});

		for (const loadModule of modules) {
			loadModule(this);
		}

		this.discord.login(config.token);
	}

	async getTextChannel(channelId: string): Promise<Discord.TextChannel> {
		return this.discord.channels.cache.get(channelId) as Discord.TextChannel;
	}

	async setStatus(status: string): Promise<void> {
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

	async feedMarkov(msg: Discord.Message): Promise<void> {
		if (msg.author.bot || msg.guild?.id !== config.guildId) return;

		const channel = msg.channel as Discord.GuildChannel;
		const guild = channel.guild;
		const perms = channel.permissionsFor(guild.roles.everyone);
		if (!perms.has("SEND_MESSAGES", false)) return; // don't get text from channels that are not "public"

		const content = msg.content;
		if (this.container.getService("Motd").isValidMsg(content))
			this.container.getService("Markov").addLine(content);
	}
	async fixTwitterEmbeds(msg: Discord.Message): Promise<void> {
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

	async handleMediaUrls(msg: Discord.Message): Promise<void> {
		// https://media.discordapp.net/attachments/769875739817410562/867369588014448650/video.mp4
		// https://cdn.discordapp.com/attachments/769875739817410562/867369588014448650/video.mp4

		const mediaUrls = msg.content.matchAll(
			/https?:\/\/media.discordapp.net\/attachments(\/\d+\/\d+\/\S+\.(webm|mp4|mov))$/g
		);

		let urls: Array<string> = [];
		for (const [, mediaUrl] of mediaUrls) {
			urls = urls.concat(`https://cdn.discordapp.com/attachments${mediaUrl}`);
		}
		if (urls.length === 0) return;

		msg.reply(urls.join("\n"));
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
