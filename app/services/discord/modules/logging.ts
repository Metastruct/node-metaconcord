import { DiscordBot, EMBED_FIELD_LIMIT } from "..";
import Discord from "discord.js";

const DELETE_COLOR: Discord.ColorResolvable = [255, 0, 0];
const EDIT_COLOR: Discord.ColorResolvable = [220, 150, 0];

export default (bot: DiscordBot): void => {
	bot.discord.on("messageCreate", async msg => {
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}
		await Promise.all([
			bot.fixTwitterEmbeds(msg),
			bot.feedMarkov(msg),
			bot.handleMediaUrls(msg),
		]);
	});

	bot.discord.on("messageDelete", async msg => {
		if (msg.partial) {
			try {
				msg = await msg.fetch();
			} catch {
				return;
			}
		}
		if (msg.author.bot) return;

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const message =
			msg.content.length > 0
				? msg.content
				: msg.attachments.size > 0
				? `[${msg.attachments.values().next().value.name}]`
				: "???";

		const embed = new Discord.MessageEmbed()
			.setAuthor(msg.author.username, msg.author.avatarURL())
			.setColor(DELETE_COLOR)
			.addField("Channel", `<#${msg.channel.id}>`)
			.addField("Mention", msg.author.mention)
			.addField("Message", message.substring(0, EMBED_FIELD_LIMIT), true)
			.setFooter("Message Deleted")
			.setTimestamp(Date.now());
		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("messageUpdate", async (oldMsg, newMsg) => {
		// discord manages embeds by updating user messages
		if (oldMsg.partial) {
			try {
				oldMsg = await oldMsg.fetch();
			} catch {
				return;
			}
		}
		if (oldMsg.content === newMsg.content) return;
		if (oldMsg.author.bot) return;

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const embed = new Discord.MessageEmbed()
			.setAuthor(oldMsg.author.username, oldMsg.author.avatarURL())
			.setColor(EDIT_COLOR)
			.addField("Channel", `<#${oldMsg.channel.id}>`)
			.addField("Mention", oldMsg.author.mention)
			.addField("New Message", newMsg.content.substring(0, EMBED_FIELD_LIMIT), true)
			.addField("Old Message", oldMsg.content.substring(0, EMBED_FIELD_LIMIT), true)
			.setFooter("Message Edited")
			.setTimestamp(newMsg.editedTimestamp);
		await logChannel.send({ embeds: [embed] });
	});
};
