import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Discord from "discord.js";
import DiscordConfig from "@/config/discord.json";
import axios from "axios";
import modules from "./modules";
import motdConfig from "@/config/motd.json";

export type Rule = {
	title: string;
	description?: string;
};

export const EMBED_FIELD_LIMIT = 1024;

let lastMessageId: string;
const ImgurRegex = /https?:\/\/(?:i.)?imgur.com\/(\w+)(?:.mp4)?/g;

export class DiscordBot extends Service {
	name = "DiscordBot";
	bridge = this.container.getService("GameBridge");
	config = DiscordConfig;
	discord: Discord.Client = new Discord.Client({
		allowedMentions: { parse: ["users", "roles"] },
		intents: [
			"Guilds",
			"GuildMembers",
			"GuildMessages",
			"GuildMessageReactions",
			"GuildModeration",
			"GuildPresences",
			"GuildScheduledEvents",
			"MessageContent",
			"GuildVoiceStates",
			"GuildIntegrations",
			"GuildWebhooks",
		],
		partials: [Discord.Partials.Message, Discord.Partials.Channel, Discord.Partials.Reaction],
	});
	ready: boolean;

	constructor(container: Container) {
		super(container);

		this.discord.on("ready", async client => {
			this.ready = true;
			console.log(`'${client.user.username}' Discord Bot has logged in`);
		});

		this.discord.on("shardDisconnect", () => {
			this.ready = false;
		});

		this.discord.on("warn", console.log);

		for (const loadModule of modules) {
			loadModule(this);
		}

		this.discord.login(this.config.bot.token);
	}

	getTextChannel(channelId: string): Discord.TextChannel | undefined {
		if (!this.ready) return;
		return this.discord.channels.cache.get(channelId) as Discord.TextChannel;
	}

	async getGuildMember(userId: string): Promise<Discord.GuildMember | undefined> {
		if (!this.ready) return;
		return this.discord.guilds.cache.get(this.config.bot.primaryGuildId)?.members.fetch(userId);
	}

	getGuild(): Discord.Guild | undefined {
		if (!this.ready) return;
		return this.discord.guilds.cache.get(this.config.bot.primaryGuildId);
	}

	async setActivity(
		status: string | Discord.Activity | undefined,
		options?: Discord.ActivitiesOptions
	): Promise<void> {
		if (!this.ready) return;
		const activity: Discord.ActivitiesOptions = { name: "Starting up", ...options };
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

		this.discord.user?.setActivity(activity);
	}

	async setNickname(name: string, reason?: string): Promise<boolean> {
		if (!this.ready || !this.discord.user || name.length > 22) return false;
		const nick = name.charAt(0).toUpperCase() + name.slice(1);
		this.getGuild()?.members.me?.setNickname(nick + " Construct", reason);
		return true;
	}

	async setServerBanner(url: string): Promise<void> {
		if (!this.ready || !(await this.overLvl2())) return;
		const guild = this.getGuild();
		const response = await axios.get(url, { responseType: "arraybuffer" });
		if (!response) return;
		guild?.setBanner(response.data, "motd");
	}

	async feedMarkov(msg: Discord.Message): Promise<void> {
		if (msg.author.bot || msg.guild?.id !== this.config.bot.primaryGuildId) return;

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
		if (!this.ready || msg.id === lastMessageId) return;

		if (!ImgurRegex.test(msg.content)) return;

		const imgurUrls = msg.content.match(ImgurRegex);

		lastMessageId = msg.id;

		const urls: Array<string> = [];
		if (imgurUrls) {
			for (const imageUrl of imgurUrls) {
				const id = Array.from(imageUrl.matchAll(ImgurRegex), m => m[1])[0]; // wtf there has to be a better way
				const info = await this.container.getService("Motd")?.getImageInfo(id);
				if (info?.has_sound) {
					urls.push(imageUrl.replace(/(?:i\.)?imgur\.com/g, "i.imgur.io"));
				}
			}
		}
		if (urls.length === 0) return;

		const fix = urls.join("\n").substring(0, EMBED_FIELD_LIMIT);
		await msg.reply({ content: fix, allowedMentions: { repliedUser: false } });
	}

	async getLastMotdMsg(): Promise<Discord.Message | undefined> {
		if (!this.ready) return;
		const channel = this.getTextChannel(motdConfig.channelId);
		if (!channel) return;
		return (
			channel.lastMessage ??
			(
				await channel.messages.fetch({
					limit: 1,
				})
			).first()
		);
	}

	async overLvl2(): Promise<boolean> {
		const guild = this.discord.guilds.cache.get(this.config.bot.primaryGuildId);
		if (!guild) return false;
		return guild.premiumTier > Discord.GuildPremiumTier.Tier1 ?? false;
	}

	async removeMotdReactions(): Promise<void> {
		const chan = this.getTextChannel(motdConfig.channelId);
		if (!chan?.lastMessage) return;
		await (await chan.lastMessage.fetch(false)).reactions.removeAll();
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	async fetchPartial(obj): Promise<any> {
		if (obj && obj.partial) {
			try {
				await obj.fetch();
			} catch {}
			return obj;
		}
		return obj;
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
