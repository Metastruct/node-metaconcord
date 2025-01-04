import { Container } from "../Container";
import { DiscordBot, SQL, Service } from ".";
import Discord from "discord.js";
import config from "@/config/starboard.json";
import discordConfig from "@/config/discord.json";

const STARBOARD_CONFIG = {
	MESSAGE_AGE_LIMIT_MS: 3 * 28 * 24 * 60 * 60 * 1000, // 3 months
	DEFAULT_AMOUNT: config.amount,
	DEFAULT_EMOTE: config.defaultEmote,
} as const;

export class Starboard extends Service {
	name = "Starboard";
	private isBusy = false;
	private sql: SQL;
	private bot: DiscordBot;

	constructor(container: Container) {
		super(container);
		this.initServices();
	}

	private async initServices(): Promise<void> {
		this.sql = await this.container.getService("SQL");
		this.bot = await this.container.getService("DiscordBot");

			const filter = (btn: Discord.MessageComponentInteraction) =>
				btn.customId.startsWith("starboard");

		this.bot.discord.on("interactionCreate", async interaction => {
				if (!interaction.isButton()) return;
				if (!filter(interaction)) return;
				if (interaction.message.author.username !== interaction.user.username) return;

				const [, originalMsgID, originalChannelID] = interaction.customId.split(":");

				const res = await interaction.message.delete().catch(console.error);
				if (res) {
					bot.getTextChannel(bot.config.channels.log)?.send(
						`Highlighted Message in ${interaction.channel} deleted by ${interaction.user} (${interaction.user.id}) -> https://discord.com/channels/${interaction.guildId}/${originalChannelID}/${originalMsgID}`
					);
				}
			});
		}
	}

	async isMsgStarred(msgId: string): Promise<boolean> {
		const db = await this.sql.getLocalDatabase();
		if (!(await this.sql.tableExists("starboard"))) {
			await db.exec(`CREATE TABLE starboard (MessageId VARCHAR(1000));`);
		}

		const res = await db.get("SELECT * FROM starboard WHERE MessageId = ? LIMIT 1;", msgId);
		return res ? true : false;
	}

	private async starMsg(msgId: string): Promise<void> {
		const db = await this.sql.getLocalDatabase();
		await db.run("INSERT INTO starboard(MessageId) VALUES(?)", msgId);
	}

	public async handleReactionAdded(reaction: Discord.MessageReaction): Promise<void> {
		if (this.isBusy) return;

		try {
			const client = reaction.client;
			const channel = reaction.message.channel as Discord.GuildChannel;
			const parent = channel.parentId;

			if (config.channelIgnores.includes(channel.id)) return;
			if (parent && config.categoryIgnores.includes(parent)) return;

			let needed: number = STARBOARD_CONFIG.DEFAULT_AMOUNT;
			let emojiFilter: string[] | undefined = [STARBOARD_CONFIG.DEFAULT_EMOTE];
			let targetChannel: Discord.Channel | undefined = client.channels.cache.get(
				discordConfig.channels.h
			);
			let title: string | undefined;
			let shouldReact = false;

			if (reaction.emoji.name !== STARBOARD_CONFIG.DEFAULT_EMOTE) {
				switch (parent) {
					// the parent of a thread is the main channel, so we sadly can't get the category without fetching, so much for dry
					case discordConfig.channels.postYourStuff:
						emojiFilter = undefined;
						shouldReact = true;
						needed = 6;
						title =
							reaction.message.channel.isThread() &&
							reaction.message.id === reaction.message.channel.id
								? reaction.message.channel.name
								: undefined;
						targetChannel = client.channels.cache.get(discordConfig.channels.hArt);
						break;
					default:
						switch (channel.id) {
							case discordConfig.channels.artChat:
								emojiFilter = undefined;
								shouldReact = true;
								needed = 6;
								targetChannel = client.channels.cache.get(
									discordConfig.channels.hArt
								);
								break;
						}
				}
			}

			const ego = reaction.message.author
				? reaction.users.cache.has(reaction.message.author.id)
				: false;
			const count = ego ? reaction.count - 1 : reaction.count;

			if (
				count >= needed &&
				!this.isBusy &&
				(emojiFilter ? emojiFilter.includes(reaction.emoji.name ?? "") : true)
			) {
				this.isBusy = true;
				const msg = await reaction.message.fetch();
				if (!msg) {
					console.error("[Starboard] couldn't fetch message", reaction);
					this.isBusy = false;
					return;
				}

				if (msg.author.bot)
					targetChannel = client.channels.cache.get(discordConfig.channels.hBot);

				if (!targetChannel) {
					console.error("[Starboard] wtf invalid channel", reaction);
					this.isBusy = false;
					return;
				}

				// check against our local db first
				if (await this.isMsgStarred(msg.id)) {
					this.isBusy = false;
					return;
				}

				// skip messages older than 3 months
				if (Date.now() - msg.createdTimestamp > STARBOARD_CONFIG.MESSAGE_AGE_LIMIT_MS) {
					this.isBusy = false;
					return;
				}

				let text = title ? `## ${title}\n` : "";

				const reference = msg.reference;
				if (reference && reference.messageId) {
					const refMsg = await (
						client.channels.cache.get(reference.channelId) as Discord.TextChannel
					).messages.fetch(reference.messageId);

					text += `${
						reference
							? `[replying to ${
									refMsg.system ? "System Message" : refMsg.author.username
							  }](${refMsg.url})\n`
							: ""
					}`;
				}

				text += msg.content;
				text += msg.stickers.size > 0 ? msg.stickers.first()?.url : "";

				const files: string[] = [];
				msg.attachments.map(a => files.push(a.url));

				const channel = targetChannel as Discord.TextChannel;

				// we need a webhook created by the application so we can attach components
				const webhooks = await channel.fetchWebhooks();
				let webhook = webhooks.find(
					h => h.applicationId === discordConfig.bot.applicationId && h.token
				);
				if (!webhook)
					webhook = await channel.createWebhook({ name: "metaconcord starboard" });

				if (webhook) {
					const components: Discord.ActionRowBuilder<Discord.ButtonBuilder>[] = [
						new Discord.ActionRowBuilder<Discord.ButtonBuilder>().addComponents(
							new Discord.ButtonBuilder()
								.setLabel("Jump to message")
								.setStyle(Discord.ButtonStyle.Link)
								.setURL(msg.url),
							...(!msg.author.bot
								? [
										new Discord.ButtonBuilder()
											.setLabel("Delete")
											.setStyle(Discord.ButtonStyle.Danger)
											.setCustomId(`starboard:${msg.id}:${msg.channelId}`),
								  ]
								: [])
						),
					];

					const starred = await webhook
						.send({
							content: text,
							avatarURL: msg.author.avatarURL() ?? "",
							username: msg.author.username,
							allowedMentions: { parse: ["users", "roles"] },
							files: files,
							embeds: msg.author.bot ? msg.embeds : undefined,
							components,
						})
						.catch();
					if (starred) {
						await this.starMsg(msg.id);
						if (shouldReact) await starred.react(reaction.emoji);
					}
				}

				this.isBusy = false;
			}
		} catch (error) {
			console.error("[Starboard] Error handling reaction:", error);
		} finally {
			this.isBusy = false;
		}
	}
}

export default (container: Container): Service => {
	return new Starboard(container);
};
