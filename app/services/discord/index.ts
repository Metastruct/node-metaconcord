import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Discord from "discord.js";
import axios from "axios";
import config from "@/config/discord.json";
import modules from "./modules";
import motdConfig from "@/config/motd.json";

export type Rule = {
	title: string;
	description?: string;
};

export const EMBED_FIELD_LIMIT = 1024;

let lastMessageId: string;
const TwitterRegex = /https?:\/\/(?:mobile.)?twitter\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/g;
const ImgurRegex = /https?:\/\/(?:i.)?imgur.com\/(\w+)(?:.mp4)?/g;

export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client({
		intents: [
			"Guilds",
			"GuildMembers",
			"GuildMessages",
			"GuildMessageReactions",
			"GuildPresences",
			"GuildScheduledEvents",
			"MessageContent",
		],
		partials: [Discord.Partials.Message, Discord.Partials.Channel, Discord.Partials.Reaction],
	});

	constructor(container: Container) {
		super(container);

		this.discord.on("ready", async () => {
			console.log(`'${this.discord.user?.username}' Discord Bot has logged in`);
		});

		this.discord.on("warn", console.log);

		for (const loadModule of modules) {
			loadModule(this);
		}

		this.discord.login(config.token);
	}

	async isElevatedUser(userId: string): Promise<boolean> {
		if (!this.discord.isReady()) return false;
		const guild = this.discord.guilds.cache.get(config.guildId);
		if (!guild) return false;
		const user = await guild.members.fetch(userId);
		return user.roles.cache.has(this.config.elevatedRoleId);
	}

	async getTextChannel(channelId: string): Promise<Discord.TextChannel | undefined> {
		if (!this.discord.isReady()) return;
		return this.discord.channels.cache.get(channelId) as Discord.TextChannel;
	}

	async setActivity(
		status: string | Discord.Activity | undefined,
		options?: Discord.ActivitiesOptions
	): Promise<void> {
		if (!this.discord.isReady()) return;
		const activity: Discord.ActivitiesOptions = { ...options };
		switch (true) {
			case status instanceof Discord.Activity: {
				status = status as Discord.Activity;
				activity.name = status.name;
				break;
			}

			case typeof status === "string": {
				status = status as string;
				if (status && status.length > 127) status = status.substring(0, 120) + "...";
				activity.name = status;
				break;
			}
			case typeof status === "undefined":
			default:
		}

		this.discord.user.setActivity(activity);
	}

	async setServerBanner(url: string): Promise<void> {
		if (!this.discord.isReady() || !(await this.overLvl2())) return;
		const guild = this.discord.guilds.cache.get(config.guildId);
		const response = await axios.get(url, { responseType: "arraybuffer" });
		if (!response) return;
		guild?.setBanner(response.data, "motd");
	}

	async feedMarkov(msg: Discord.Message): Promise<void> {
		if (msg.author.bot || msg.guild?.id !== config.guildId) return;

		const channel = msg.channel as Discord.GuildChannel;
		const guild = channel.guild;
		const perms = channel.permissionsFor(guild.roles.everyone);
		if (!perms.has("SendMessages", false)) return; // don't get text from channels that are not "public"

		const content = msg.content;
		if (this.container.getService("Motd")?.isValidMsg(content))
			this.container.getService("Markov")?.learn({
				authorName: msg.author.username,
				authorID: msg.author.id,
				message: msg.content,
			});
	}

	async fixEmbeds(msg: Discord.Message): Promise<void> {
		if (!this.discord.isReady() || msg.id === lastMessageId) return;

		if (!TwitterRegex.test(msg.content) && !ImgurRegex.test(msg.content)) return;

		const twitterUrls = msg.content.match(TwitterRegex);
		const imgurUrls = msg.content.match(ImgurRegex);

		lastMessageId = msg.id;

		let urls: Array<string> = [];
		if (twitterUrls) {
			for (const statusUrl of twitterUrls) {
				const mediaUrls = await this.container
					.getService("Twitter")
					?.getStatusMediaURLs(statusUrl);
				urls = urls.concat(mediaUrls ?? "");
			}
		}
		if (imgurUrls) {
			for (const imageUrl of imgurUrls) {
				const id = Array.from(imageUrl.matchAll(ImgurRegex), m => m[1])[0]; // wtf there has to be a better way
				const info = await this.container.getService("Motd")?.getImageInfo(id);
				if (info?.has_sound) {
					urls.push(imageUrl.replace(".com", ".io"));
				}
			}
		}
		if (urls.length === 0) return;

		const fix = urls.join("\n").substring(0, EMBED_FIELD_LIMIT);
		await msg.reply({ content: fix, allowedMentions: { repliedUser: false } });
	}

	async getLastMotdMsg(): Promise<Discord.Message | undefined> {
		if (!this.discord.isReady()) return;
		const channel = await this.getTextChannel(motdConfig.channelId);
		if (!channel) return;
		return (
			channel?.lastMessage ??
			(
				await channel?.messages.fetch({
					limit: 1,
				})
			).first()
		);
	}

	async overLvl2(): Promise<boolean> {
		const guild = this.discord.guilds.cache.get(config.guildId);
		if (!guild) return false;
		return guild.premiumTier > Discord.GuildPremiumTier.Tier1 ?? false;
	}

	async removeMotdReactions(): Promise<void> {
		const chan = await this.getTextChannel(motdConfig.channelId);
		if (!chan?.lastMessage) return;
		await (await chan.lastMessage.fetch()).reactions.removeAll();
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	async fetchPartial(obj): Promise<any> {
		if (obj && obj.partial) {
			try {
				await obj.fetch(true);
			} catch {}
			return obj;
		}
		return obj;
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
