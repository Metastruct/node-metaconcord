import { DiscordBot, EMBED_FIELD_LIMIT } from "..";
import { diffWords } from "diff";
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

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const message = msg.content && msg.content.length > 0 ? msg.content : undefined;

		const attachments =
			msg.attachments.size > 0
				? msg.attachments.map(a => {
						return `[${a.name}](${a.url})`;
				  })
				: undefined;

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: msg.author?.username ?? "unknown user",
				iconURL: msg.author?.avatarURL() ?? "",
			})
			.setColor(RED_COLOR)
			.addField("Channel", `<#${msg.channel.id}>`)
			.addField("Mention", msg.author?.mention ?? "???")
			.setFooter({ text: "Message Deleted" })
			.setTimestamp(Date.now());

		if (message) {
			embed.addField("Message", message, true);
		}

		if (attachments) {
			embed.addField("Attachment", attachments.join(" "));
		}

		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("messageUpdate", async (oldMsg, newMsg) => {
		oldMsg = await bot.fetchPartial(oldMsg);
		if (oldMsg.content === newMsg.content) return; // discord manages embeds by updating user messages
		const user = oldMsg.author ?? newMsg.author;
		if (user?.bot) return;

		if (!newMsg.partial) {
			await bot.fixTwitterEmbeds(newMsg);
		}

		const logChannel = await bot.getTextChannel(bot.config.logChannelId);
		if (!logChannel) return;

		const oldText = oldMsg.content ? oldMsg.content.substring(0, EMBED_FIELD_LIMIT - 10) : "";
		const newText = newMsg.content ? newMsg.content.substring(0, EMBED_FIELD_LIMIT - 10) : "";

		const embeds: [boolean, boolean] = // I think this can be done better somehow lol
			newMsg.embeds.length > 0 && oldMsg.embeds.length > 0
				? [true, true]
				: newMsg.embeds.length > 0 && oldMsg.embeds.length === 0
				? [true, false]
				: newMsg.embeds.length === 0 && oldMsg.embeds.length > 0
				? [false, true]
				: [false, false];

		let diff = "";
		if (oldText.length > 0 || newText.length > 0) {
			const diffList = diffWords(oldText, newText);

			for (const part of diffList) {
				diff += part.added
					? `"${part.value}"`
					: part.removed
					? `'${part.value}'`
					: part.value.replace("```", "\\`\\`\\`");
			}
		}

		const embed = new Discord.MessageEmbed()
			.setAuthor({
				name: user?.username ?? user?.username ?? "unknown user",
				iconURL: user?.avatarURL() ?? user?.avatarURL() ?? "",
			})
			.setColor(YELLOW_COLOR)
			.addField("Channel", `<#${oldMsg.channel.id}>`)
			.addField("Mention", user?.mention ?? "???")
			.addField("Difference", `\`\`\`ml\n${diff}\n\`\`\``)
			.setFooter({ text: "Message Edited" })
			.setTimestamp(newMsg.editedTimestamp);

		if (!(embeds[0] === false && embeds[1] === false)) {
			embed.addField(
				"Embeds",
				`Embed ${
					embeds[0] && embeds[1]
						? "modified"
						: embeds[0] && !embeds[1]
						? "added"
						: "removed"
				}`
			);
		}

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
