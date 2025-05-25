import * as Discord from "discord.js";
import { Container, Service } from "@/app/Container.js";
import { Data, GameBridge } from "@/app/services/index.js";
import { getAsBase64 } from "@/utils.js";
import { getEventIcon } from "./modules/discord-guild-icon.js";
import DiscordConfig from "@/config/discord.json" with { type: "json" };
import modules from "./modules/index.js";
import motdConfig from "@/config/motd.json" with { type: "json" };

export type Rule = {
	title: string;
	description?: string;
};

export const EMBED_FIELD_LIMIT = 1024;

let lastMessageId: string;
const ImgurRegex = /https?:\/\/(?:i.)?imgur.com\/(\w+)(?:.mp4)?/g;

export class DiscordBot extends Service {
	name = "DiscordBot";
	bridge: GameBridge;
	readonly config = DiscordConfig;
	readonly discord: Discord.Client = new Discord.Client({
		allowedMentions: { parse: ["users", "roles"] },
		intents: [
			"Guilds",
			"GuildEmojisAndStickers",
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
		closeTimeout: 5000,
		rest: { timeout: 30000 },
	});
	ready: boolean;
	private data: Data;

	constructor(container: Container) {
		super(container);

		this.initServices();
	}

	private async initServices() {
		this.data = await this.container.getService("Data");
		this.bridge = await this.container.getService("GameBridge");

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
		try {
			const user = this.discord.guilds.cache
				.get(this.config.bot.primaryGuildId)
				?.members.fetch(userId);
			return user;
		} catch {
			return;
		}
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

	// sets both the bot's avatar and the guild's icon
	async setIcon(path?: string, reason?: string): Promise<boolean> {
		if (!this.ready || !this.discord.user) return false;
		try {
			const guild = this.getGuild();
			if (!guild) return false;

			if (!path) {
				path = (await getEventIcon()).filePath;
			}

			const iconURL =
				this.discord.user.avatarURL({ size: 4096 }) ?? guild.iconURL({ size: 4096 });
			this.data.lastDiscordGuildIcon = iconURL
				? ((await getAsBase64(iconURL)) ?? this.data.lastDiscordGuildIcon)
				: this.data.lastDiscordGuildIcon;
			await this.data.save();
			await this.discord.user.setAvatar(path);
			await guild.setIcon(path, reason);
			return true;
		} catch {
			return false;
		}
	}

	async setNickname(
		name = this.data.lastDiscordNickName ?? "Meta",
		reason?: string
	): Promise<boolean> {
		if (!this.ready || name.length > 22) return false;
		try {
			let newNick = name.charAt(0).toUpperCase() + name.slice(1);
			const currentNick = this.getNickname();
			this.data.lastDiscordNickName = currentNick ?? "Meta";
			if (currentNick === newNick) newNick = "Meta";
			await this.data.save();
			await this.getGuild()?.members.me?.setNickname(newNick + " Construct", reason);
			return true;
		} catch {
			return false;
		}
	}

	getNickname(): string | undefined {
		return this.getGuild()?.members.me?.nickname?.split(" ")[0] ?? undefined;
	}

	async setServerBanner(url?: string, reason?: string): Promise<boolean> {
		if (!this.ready || !(await this.overLvl2())) return false;
		try {
			const guild = this.getGuild();
			if (!guild) return false;

			let banner = "";
			const bannerURL = guild.bannerURL({ size: 4096 });
			if (bannerURL) {
				const bannerBase64 = await getAsBase64(bannerURL);
				banner = bannerBase64 ?? "";
			}
			this.data.lastDiscordBanner = banner ?? this.data.lastDiscordBanner;
			await this.data.save();

			await guild.setBanner(url ?? null, reason);
			return true;
		} catch {
			return false;
		}
	}

	async feedMarkov(msg: Discord.Message): Promise<void> {
		if (msg.author.bot || msg.guild?.id !== this.config.bot.primaryGuildId) return;

		const channel = msg.channel as Discord.GuildChannel;
		const guild = channel.guild;
		const perms = channel.permissionsFor(guild.roles.everyone);
		if (!perms.has("SendMessages", false)) return; // don't get text from channels that are not "public"

		const content = msg.content;
		if ((await this.container.getService("Motd")).isValidMsg(content))
			(await this.container.getService("Markov")).learn(msg.content);
	}

	async fixEmbeds(msg: Discord.Message): Promise<void> {
		if (!this.ready || msg.id === lastMessageId || msg.author.id === msg.client.user.id) return;

		if (!ImgurRegex.test(msg.content)) return;

		const imgurUrls = msg.content.match(ImgurRegex);

		lastMessageId = msg.id;

		const urls: Array<string> = [];
		if (imgurUrls) {
			for (const imageUrl of imgurUrls) {
				const id = Array.from(imageUrl.matchAll(ImgurRegex), m => m[1])[0]; // wtf there has to be a better way
				const info = await (await this.container.getService("Motd")).getImageInfo(id);
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
		return guild.premiumTier > Discord.GuildPremiumTier.Tier1;
	}

	async removeMotdReactions(): Promise<void> {
		const chan = this.getTextChannel(motdConfig.channelId);
		if (!chan?.lastMessage) return;
		await (await chan.lastMessage.fetch(false)).reactions.removeAll();
	}

	// eslint-disable-next-line @typescript-eslint/explicit-module-boundary-types
	async fetchPartial(obj): Promise<any> {
		try {
			return obj.partial ? await obj.fetch() : obj;
		} catch (e) {
			return obj;
		}
	}
}

export default (container: Container): Service => {
	return new DiscordBot(container);
};
