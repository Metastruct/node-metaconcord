import { Container } from "../Container";
import { SQL } from "./SQL";
import { Service } from ".";
import Discord from "discord.js";
import config from "@/config/starboard.json";
import discordConfig from "@/config/discord.json";

const DEFAULT_AMOUNT = config.amount;
const DEFAULT_EMOTE = config.defaultEmote;

export class Starboard extends Service {
	name = "Starboard";
	private isBusy = false;
	private sql: SQL | undefined;

	constructor(container: Container) {
		super(container);
		this.sql = this.container.getService("SQL");
	}

	private async isMsgStarred(msgId: string): Promise<boolean> {
		if (!this.sql) return true;
		const db = await this.sql.getLocalDatabase();
		if (!(await this.sql.tableExists("starboard"))) {
			await db.exec(`CREATE TABLE starboard (MessageId VARCHAR(1000));`);
		}

		const res = await db.get("SELECT * FROM starboard WHERE MessageId = ? LIMIT 1;", msgId);
		return res ? true : false;
	}

	private async starMsg(msgId: string): Promise<void> {
		if (!this.sql) return;
		const db = await this.sql.getLocalDatabase();
		await db.run("INSERT INTO starboard(MessageId) VALUES(?)", msgId);
	}

	public async handleReactionAdded(reaction: Discord.MessageReaction): Promise<void> {
		const client = reaction.client;
		const channel = reaction.message.channel as Discord.GuildChannel;
		const parent = channel.parentId;

		if (config.channelIgnores.includes(channel.id)) return;
		if (parent && config.categoryIgnores.includes(parent)) return;

		let needed: number;
		let emojiFilter: string[] | undefined;
		let targetChannel: Discord.Channel | undefined;

		switch (parent) {
			case discordConfig.channels.artsAndCrafts:
				needed = 6;
				targetChannel = client.channels.cache.get(discordConfig.channels.hArt);
				break;
			default:
				switch (channel.id) {
					case discordConfig.channels.artChat:
						needed = 6;
						targetChannel = client.channels.cache.get(discordConfig.channels.hArt);
						break;
					default:
						needed = DEFAULT_AMOUNT;
						emojiFilter = [DEFAULT_EMOTE];
						targetChannel = client.channels.cache.get(discordConfig.channels.h);
						break;
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
			if (Date.now() - msg.createdTimestamp > 3 * 28 * 24 * 60 * 60 * 1000) {
				this.isBusy = false;
				return;
			}

			let text = "";
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

			const webhooks = await (targetChannel as Discord.TextChannel).fetchWebhooks();
			const webhook = webhooks.find(h => h.token);

			if (webhook) {
				await webhook.send({
					content: text,
					avatarURL: msg.author.avatarURL() ?? "",
					username: `${msg.author.username}`,
					allowedMentions: { parse: ["users", "roles"] },
					files: files,
					embeds: msg.author.bot ? msg.embeds : undefined,
					components: [
						{
							type: Discord.ComponentType.ActionRow,
							components: [
								{
									type: Discord.ComponentType.Button,
									label: "Original Message",
									style: Discord.ButtonStyle.Link,
									url: msg.url,
								},
							],
						},
					],
				});
				await this.starMsg(msg.id);
			}
			this.isBusy = false;
		}
	}
}

export default (container: Container): Service => {
	return new Starboard(container);
};
