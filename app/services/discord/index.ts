import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import Discord, { ActivityType, GuildPremiumTier, Partials } from "discord.js";
import axios from "axios";
import config from "@/config/discord.json";
import modules from "./modules";
import motdConfig from "@/config/motd.json";

export type Rule = {
	title: string;
	description?: string;
};

export const EMBED_FIELD_LIMIT = 1024;

let lastTwMessageId: string;
export class DiscordBot extends Service {
	name = "DiscordBot";
	config = config;
	discord: Discord.Client = new Discord.Client({
		intents: [
			"Guilds",
			"GuildMembers",
			"GuildMessages",
			"GuildMessageReactions",
			"MessageContent",
		],
		partials: [Partials.Message, Partials.Channel, Partials.Reaction],
	});

	constructor(container: Container) {
		super(container);

		this.discord.on("ready", async () => {
			console.log(`'${this.discord.user?.username}' Discord Bot has logged in`);
			setInterval(async () => {
				try {
					const newStatus = await this.container.getService("Markov")?.generate();
					this.setStatus(newStatus ?? "Crashing the source engine");
				} catch {} // who cares
			}, 1000 * 60 * 10); // change status every 10mins
			this.setStatus("Crashing the source engine");
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

	async setStatus(status: string): Promise<void> {
		if (!this.discord.isReady()) return;
		if (status.length > 127) status = status.substring(0, 120) + "...";

		const validActivities = [0, 1, 2, 3, 5];

		this.discord.user.setPresence({
			activities: [
				{
					name: status.trim().substring(0, 100),
					type: Math.floor(validActivities[Math.random() * validActivities.length]),
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
	async fixTwitterEmbeds(msg: Discord.Message): Promise<void> {
		if (!this.discord.isReady() || msg.id === lastTwMessageId) return;

		const statusUrls = msg.content.match(
			/https?:\/\/(?:mobile.)?twitter\.com\/(?:#!\/)?(\w+)\/status(es)?\/(\d+)/g
		);
		if (!statusUrls) return;

		lastTwMessageId = msg.id;

		let urls: Array<string> = [];
		for (const statusUrl of statusUrls) {
			const mediaUrls = await this.container
				.getService("Twitter")
				?.getStatusMediaURLs(statusUrl);
			urls = urls.concat(mediaUrls ?? "");
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
		return guild.premiumTier > GuildPremiumTier.Tier1 ?? false;
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
