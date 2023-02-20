import { Container } from "../Container";
import { GuildChannel, MessageReaction } from "discord.js";
import { SQL } from "./SQL";
import { Service } from ".";
import { TextChannel } from "discord.js";
import config from "@/config/starboard.json";

const AMOUNT = config.amount;
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

	public async handleReactionAdded(reaction: MessageReaction): Promise<void> {
		const channel = reaction.message.channel as GuildChannel;
		const category = channel.parentId;
		if (config.channelIgnores.includes(channel.id)) return;
		if (category && config.categoryIgnores.includes(category)) return;

		if (reaction.emoji.id === config.emoteId) {
			let ego = false;
			if (reaction.message.author)
				ego = reaction.users.cache.has(reaction.message.author?.id);

			let count = ego ? reaction.count - 1 : reaction.count;
			count = reaction.users.cache.has(reaction.client.user.id) ? count - 1 : count;
			if (count >= AMOUNT && !this.isBusy) {
				this.isBusy = true;
				const client = reaction.client;
				const msg = await reaction.message.fetch();
				if (!msg) return;

				// don't loop
				if (msg.channel.id === config.channelId) return;

				// check against our local db first
				if (await this.isMsgStarred(msg.id)) return;

				// skip messages older than 3 months
				if (Date.now() - msg.createdTimestamp > 3 * 28 * 24 * 60 * 60 * 1000) return;

				let text = "";
				const reference = msg.reference;
				if (reference && reference.messageId) {
					const refMsg = await (
						client.channels.cache.get(reference.channelId) as TextChannel
					).messages.fetch(reference.messageId);

					text += `${
						reference ? `[replying to ${refMsg.author.username}](${refMsg.url})\n` : ""
					}`;
				}

				text += msg.content;
				text +=
					msg.attachments.size > 0
						? "\n" + msg.attachments.map(a => a.url).join("\n")
						: "";
				text += msg.stickers.size > 0 ? msg.stickers.first()?.url : "";

				if (text === "") return;

				const channel = client.channels.cache.get(
					msg.author.bot ? config.extraChannelId : config.channelId
				);
				const webhooks = await (channel as TextChannel).fetchWebhooks();
				const webhook = webhooks.find(h => h.token);

				if (webhook) {
					await webhook.send({
						content: text,
						avatarURL: msg.author.avatarURL() ?? "",
						username: `${msg.author.username}`,
						allowedMentions: { parse: ["users", "roles"] },
					});
					await this.starMsg(msg.id);
				}
			}
			this.isBusy = false;
		}
	}
}

export default (container: Container): Service => {
	return new Starboard(container);
};
