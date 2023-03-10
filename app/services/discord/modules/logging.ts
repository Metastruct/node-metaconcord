import { DiscordBot, EMBED_FIELD_LIMIT } from "..";
import { diffWords } from "diff";
import { f } from "@/utils";
import Discord from "discord.js";

const RED_COLOR = Discord.Colors.Red;
const YELLOW_COLOR = Discord.Colors.Yellow;
const GREEN_COLOR = Discord.Colors.Green;

export default (bot: DiscordBot): void => {
	let logChannel: Discord.TextChannel | undefined;

	bot.discord.once("ready", () => {
		logChannel = bot.getTextChannel(bot.config.channels.log);
	});

	bot.discord.on("messageCreate", async msg => {
		msg = await bot.fetchPartial(msg);
		await Promise.all([bot.fixEmbeds(msg), bot.feedMarkov(msg)]);
	});

	bot.discord.on("messageDelete", async msg => {
		if (!logChannel) return;
		msg = await bot.fetchPartial(msg);

		const message = msg.content && msg.content.length > 0 ? msg.content : undefined;

		const attachments =
			msg.attachments.size > 0
				? msg.attachments.map(a => {
						return `[${a.name}](${a.url})`;
				  })
				: undefined;

		const embeds =
			msg.embeds.length > 0
				? msg.embeds.map(e => {
						return `\`\`\`json\n${JSON.stringify(e.data)
							.replace("`", "\\`")
							.substring(0, 1024 - 11)}\`\`\``;
				  })
				: undefined;

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: msg.author?.username ?? "unknown user",
				iconURL: msg.author?.avatarURL() ?? undefined,
			})
			.setColor(RED_COLOR)
			.addFields(f("Channel", `<#${msg.channel.id}>`))
			.setFooter({ text: "Message Deleted" })
			.setTimestamp(msg.createdTimestamp);

		if (msg.author?.mention) {
			embed.addFields(f("Mention", msg.author?.mention));
		}
		if (message) {
			embed.addFields(f("Message", message.substring(0, 1024), true));
		}

		if (attachments) {
			embed.addFields(f("Attachment/s", attachments.join(" ")));
		}

		if (embeds) {
			embed.addFields(f("Embed/s", embeds.join("\n")));
		}

		if (msg.stickers.size > 0) {
			embed.addFields(f("Sticker/s", msg.stickers.map(sticker => sticker.url).join("\n")));
		}

		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("messageUpdate", async (oldMsg, newMsg) => {
		if (!logChannel) return;

		oldMsg = await bot.fetchPartial(oldMsg);
		if (oldMsg.content === newMsg.content) return; // discord manages embeds by updating user messages
		const user = oldMsg.author ?? newMsg.author;
		if (user?.bot) return;

		if (!newMsg.partial) {
			await bot.fixEmbeds(newMsg);
		}

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
					? `\u001b[1;40m${part.value}\u001b[0;0m`
					: part.removed
					? `\u001b[1;30;41m${part.value}\u001b[0;0m`
					: part.value;
			}
		}
		diff = diff.replace("`", "\\`");

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: user?.username ?? user?.username ?? "unknown user",
				iconURL: user?.avatarURL() ?? user?.avatarURL() ?? undefined,
				url: newMsg.url,
			})
			.setColor(YELLOW_COLOR)
			.addFields(f("Channel", `<#${oldMsg.channel.id}>`))
			.addFields(f("Mention", user?.mention ?? "???"))
			.addFields(f("Difference", `\`\`\`ansi\n${diff.substring(0, 1010)}\n\`\`\``))
			.setFooter({ text: "Message Edited" })
			.setTimestamp(newMsg.editedTimestamp);

		if (!(embeds[0] === false && embeds[1] === false)) {
			embed.addFields(
				f(
					"Embeds",
					`Embed ${
						embeds[0] && embeds[1]
							? "modified"
							: embeds[0] && !embeds[1]
							? "added"
							: "removed"
					}`
				)
			);
		}

		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("guildMemberRemove", async user => {
		if (!logChannel) return;
		user = await bot.fetchPartial(user);

		const embed = new Discord.EmbedBuilder()
			.setAuthor({ name: user.displayName, iconURL: user.avatarURL() ?? undefined })
			.setColor(RED_COLOR)
			.addFields(f("Mention", user.mention))
			.setFooter({ text: "Member Left/Kicked" })
			.setTimestamp(Date.now());
		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("guildMemberAdd", async user => {
		if (!logChannel) return;
		user = await bot.fetchPartial(user);

		const embed = new Discord.EmbedBuilder()
			.setAuthor({ name: user.displayName, iconURL: user.avatarURL() ?? undefined })
			.setColor(GREEN_COLOR)
			.addFields(f("Mention", user.mention))
			.setFooter({ text: "Member joined" })
			.setTimestamp(Date.now());
		await logChannel.send({ embeds: [embed] });
	});
};
