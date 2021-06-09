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

	public async handleReactionAdded(reaction: MessageReaction): Promise<void> {
		if (reaction.emoji.id === config.emoteId && reaction.count >= AMOUNT) {
			const client = reaction.client;
			const msg = await reaction.message.fetch();
			const channel = (await client.channels.fetch(config.channelId)) as Discord.TextChannel;

			if (msg.channel.id === config.channelId) return;

			let old = await channel.messages.fetch({ limit: 100 });
			old = old.filter(
				m =>
					(msg.content.length > 0 && m.content === msg.content) ||
					(m.embeds.length > 0 &&
						m.embeds.some((e: MessageEmbedOptions) => e.author.url.includes(msg.id)))
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
		}
	}
}

export default (container: Container): Service => {
	return new Starboard(container);
};
