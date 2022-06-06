import { DiscordBot, EMBED_FIELD_LIMIT } from "..";
import Discord from "discord.js";

const RED_COLOR: Discord.ColorResolvable = [255, 0, 0];
const YELLOW_COLOR: Discord.ColorResolvable = [220, 150, 0];

export default (bot: DiscordBot): void => {
	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		await Promise.all([bot.fixTwitterEmbeds(msg), bot.feedMarkov(msg)]);
	});

	bot.discord.on("messageDelete", async msg => {
		msg = await bot.fetchPartial(msg);
		if (msg.author?.bot) return;

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const message = msg.content
			? msg.content.length > 0
				? msg.content
				: msg.attachments.size > 0
				? `[${msg.attachments.values().next().value.name}]`
				: "???"
			: "";

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: msg.author?.username ?? "unknown user",
				iconURL: msg.author?.avatarURL() ?? "",
			})
			.setColor(RED_COLOR)
			.addField("Channel", `<#${msg.channel.id}>`)
			.addField("Mention", msg.author?.mention ?? "???")
			.addField(
				"Message",
				message.length > 0
					? message.substring(0, EMBED_FIELD_LIMIT)
					: "(not fetchable/cached)",
				true
			)
			.setFooter({ text: "Message Deleted" })
			.setTimestamp(Date.now());
		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("messageUpdate", async (oldMsg, newMsg) => {
		oldMsg = await bot.fetchPartial(oldMsg);
		if (oldMsg.content === newMsg.content) return; // discord manages embeds by updating user messages
		if (oldMsg.author?.bot) return;

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: oldMsg.author?.username ?? "unknown user",
				iconURL: oldMsg.author?.avatarURL() ?? "",
			})
			.setColor(YELLOW_COLOR)
			.addField("Channel", `<#${oldMsg.channel.id}>`)
			.addField("Mention", oldMsg.author?.mention ?? "???")
			.addField(
				"New Message",
				newMsg.content ? newMsg.content.substring(0, EMBED_FIELD_LIMIT) : "???",
				true
			)
			.addField(
				"Old Message",
				oldMsg.content ? oldMsg.content.substring(0, EMBED_FIELD_LIMIT) : "???",
				true
			)
			.setFooter({ text: "Message Edited" })
			.setTimestamp(newMsg.editedTimestamp);
		await logChannel.send({ embeds: [embed] });
	});
	bot.discord.on("guildMemberRemove", async user => {
		user = await bot.fetchPartial(user);
		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const embed = new Discord.MessageEmbed()
			.setAuthor({ name: user.displayName, iconURL: user.avatarURL() ?? "" })
			.setColor(RED_COLOR)
			.addField("Mention", user.mention)
			.setFooter({ text: "Member Left/Kicked" })
			.setTimestamp(Date.now());
		await logChannel.send({ embeds: [embed] });
	});
};
