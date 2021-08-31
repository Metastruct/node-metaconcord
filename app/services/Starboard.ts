import { Container } from "../Container";
import { MessageEmbedOptions } from "discord.js";
import { MessageReaction } from "discord.js";
import { Service } from ".";
import { TextChannel } from "discord.js";
import Discord from "discord.js";
import config from "@/config/starboard.json";

const AMOUNT = config.amount;
const WHC = new Discord.WebhookClient(
	{ id: config.webhookId, token: config.webhookToken },
	{ allowedMentions: { parse: ["users", "roles"] } }
);

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

			// don't loop
			if (msg.channel.id === config.channelId) return;

			// check against our local db first
			if (await this.isMsgStarred(msg.id)) return;

			let text = "";
			const reference = msg.reference;
			if (reference) {
				const refMsg = await (
					client.channels.cache.get(reference.channelId) as TextChannel
				).messages.fetch(reference.messageId);
				text += `${
					reference ? `[replying to ${refMsg.author.username}](${refMsg.url})\n` : ""
				}`;
			}

			text += msg.content;
			text += `${msg.attachments.size > 0 ? "\n" + msg.attachments.first().url : ""}`;

			await WHC.send({
				content: text,
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
