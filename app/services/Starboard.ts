import { Container } from "../Container";
import { MessageEmbedOptions } from "discord.js";
import { MessageReaction } from "discord.js";
import { Service } from ".";
import { TextChannel } from "discord.js";
import Discord from "discord.js";
import config from "@/starboard.json";

const AMOUNT = config.amount;
const WHC = new Discord.WebhookClient(config.webhookId, config.webhookToken, {
	allowedMentions: { parse: ["users", "roles"] },
});

export class Starboard extends Service {
	name = "Starboard";

	private async isMsgStarred(msgId: string): Promise<boolean> {
		const sql = this.container.getService("Sql");
		const db = await sql.getDatabase();
		if (!(await sql.tableExists("starboard"))) {
			await db.exec(`CREATE TABLE starboard (MessageId VARCHAR(1000));`);
		}

		const res = await db.get("SELECT * FROM starboard WHERE MessageId = ? LIMIT 1;", msgId);
		return res ? true : false;
	}

	private async starMsg(msgId: string): Promise<void> {
		const sql = this.container.getService("Sql");
		const db = await sql.getDatabase();
		await db.run("INSERT INTO starboard(MessageId) VALUES(?)", msgId);
	}

	public async handleReactionAdded(reaction: MessageReaction): Promise<void> {
		if (reaction.emoji.id === config.emoteId && reaction.count >= AMOUNT) {
			const client = reaction.client;
			const msg = await reaction.message.fetch();
			const channel = (await client.channels.fetch(config.channelId)) as Discord.TextChannel;

			if (msg.channel.id === config.channelId) return;

			// check against our local db first
			if (await this.isMsgStarred(msg.id)) return;

			// check against channel in case (for old messages mostly)
			let old = await channel.messages.fetch({ limit: 100 });
			old = old.filter(
				m =>
					(msg.content.length > 0 && m.content === msg.content) ||
					(m.embeds.length > 0 &&
						m.embeds.some((e: MessageEmbedOptions) => e.author?.url.includes(msg.id)))
			);

			if (old.size > 0) return;

			let text = "";
			const reference = msg.reference;
			if (reference) {
				const refMsg = await (
					client.channels.resolve(reference.channelID) as TextChannel
				).messages.fetch(reference.messageID);
				text += `${
					reference ? `[replying to ${refMsg.author.username}](${refMsg.url})\n` : ""
				}`;
			}

			text += msg.content;
			text += `${msg.attachments.size > 0 ? "\n" + msg.attachments.first().url : ""}`;

			await WHC.send(text, {
				avatarURL: msg.author.avatarURL(),
				username: `${msg.author.username}`,
			});
			await this.starMsg(msg.id);
		}
	}
}

export default (container: Container): Service => {
	return new Starboard(container);
};
