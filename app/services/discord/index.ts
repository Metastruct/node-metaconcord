import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Discord from "discord.js";
import axios from "axios";
import config from "@/config/discord.json";
import modules from "./modules";
import motdConfig from "@/config/motd.json";

export const EMBED_FIELD_LIMIT = 1024;

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

			// setInterval(() => {
			// 	try {
			// 		const newStatus = this.container.getService("Markov").generate();
			// 		this.setStatus(newStatus);
			// 	} catch {} // who cares
			// }, 1000 * 60 * 10); // change status every 10mins
		});

		this.discord.on("warn", console.log);

		for (const loadModule of modules) {
			loadModule(this);
		}

		this.discord.login(config.token);
	}

	async getTextChannel(channelId: string): Promise<Discord.TextChannel> {
		if (!this.discord.isReady()) return;
		return this.discord.channels.cache.get(channelId) as Discord.TextChannel;
	}

	async setStatus(status: string): Promise<void> {
		if (!this.discord.isReady()) return;
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

	async setServerBanner(url: string): Promise<void> {
		if (!this.discord.isReady() || !(await this.overLvl2())) return;
		const guild = this.discord.guilds.cache.get(config.guildId);
		const response = await axios.get(url, { responseType: "arraybuffer" });
		if (!response) return;
		guild.setBanner(response.data, "motd");
	}

	// async feedMarkov(msg: Discord.Message): Promise<void> {
	// 	if (msg.author.bot || msg.guild?.id !== config.guildId) return;

	// 	const channel = msg.channel as Discord.GuildChannel;
	// 	const guild = channel.guild;
	// 	const perms = channel.permissionsFor(guild.roles.everyone);
	// 	if (!perms.has("SEND_MESSAGES", false)) return; // don't get text from channels that are not "public"

	// 	const content = msg.content;
	// 	if (this.container.getService("Motd").isValidMsg(content))
	// 		this.container.getService("Markov").addLine(content);
	// }
	async fixTwitterEmbeds(msg: Discord.Message): Promise<void> {
		if (!this.discord.isReady()) return;
		const statusUrls = msg.content.match(
			/https?:\/\/(?:mobile.)?twitter\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/g
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
		await msg.reply({ content: fix, allowedMentions: { repliedUser: false } });
	}

	async handleMediaUrls(msg: Discord.Message): Promise<void> {
		if (!this.discord.isReady()) return;
		// https://media.discordapp.net/attachments/769875739817410562/867369588014448650/video.mp4
		// https://cdn.discordapp.com/attachments/769875739817410562/867369588014448650/video.mp4

		const mediaUrls = msg.content.matchAll(
			/https?:\/\/media.discordapp.net\/attachments(\/\d+\/\d+\/\S+\.(webm|mp4))$/g
		);

		let urls: Array<string> = [];
		for (const [, mediaUrl] of mediaUrls) {
			urls = urls.concat(`https://cdn.discordapp.com/attachments${mediaUrl}`);
		}
		if (urls.length === 0) return;

		msg.reply(urls.join("\n"));
	}
	async getLastMotdMsg(): Promise<Discord.Message> {
		if (!this.discord.isReady()) return;
		return (await this.getTextChannel(motdConfig.channelId)).lastMessage; // I could get the channel from the webhook but woefhwoaegfrh
	}
	async overLvl2(): Promise<boolean> {
		const guild = this.discord.guilds.cache.get(config.guildId);
		return guild.premiumTier > "TIER_1";
	}
	async removeMotdReactions(): Promise<void> {
		const chan = await this.getTextChannel(motdConfig.channelId);
		await (await chan.lastMessage.fetch()).reactions.removeAll();
	}
	// how the fuck do I type this
	async fetchPartial(obj): Promise<any> {
		if (obj && obj.partial) {
			return await obj.fetch();
		}
		return obj;
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
