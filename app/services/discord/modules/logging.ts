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

	bot.discord.on("guildAuditLogEntryCreate", async (entry, guild) => {
		if (!logChannel) return;
		if (!entry.executorId) return;
		const user = guild.members.cache.get(entry.executorId);
		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: user?.displayName ?? "unknown user",
				iconURL: user?.avatarURL() ?? undefined,
			})
			.setFooter({ text: entry.targetType + " " + entry.actionType })
			.setTimestamp(Date.now());

		switch (entry.actionType) {
			case "Create":
				embed.setColor(GREEN_COLOR);
				break;
			case "Delete":
				embed.setColor(RED_COLOR);
				break;
			case "Update":
				embed.setColor(YELLOW_COLOR);
				break;
		}

		if (user?.mention) embed.addFields(f("Mention", user.mention));

		if (entry.target && entry.targetId) {
			let target = "???";
			switch (entry.targetType) {
				case "ApplicationCommand": {
					const command = guild.commands.cache.get(entry.targetId);
					target = command ? `</${command.name}:${command.id}` : entry.targetId;
					break;
				}
				case "AutoModerationRule": {
					target =
						guild.autoModerationRules.cache.get(entry.targetId)?.name ?? entry.targetId;
					break;
				}
				case "Channel": {
					target =
						guild.channels.cache.get(entry.targetId)?.toString() ??
						`<#${entry.targetId}>`;
					break;
				}
				case "Emoji": {
					target = guild.emojis.cache.get(entry.targetId)?.toString() ?? entry.targetId;
					break;
				}
				case "Guild": {
					target =
						entry.targetId === bot.config.bot.primaryGuildId
							? "Meta Construct"
							: "wtf?????";
					break;
				}
				case "GuildScheduledEvent": {
					target =
						guild.scheduledEvents.cache.get(entry.targetId)?.toString() ??
						entry.targetId;
					break;
				}
				case "Integration": {
					target =
						(await guild.fetchIntegrations()).get(entry.targetId)?.name ??
						entry.targetId;
					break;
				}
				case "Invite": {
					target = guild.invites.cache.get(entry.targetId)?.toString() ?? entry.targetId;
					break;
				}
				case "Message": {
					target = entry.targetId;
					break;
				}
				case "Role": {
					target = guild.roles.cache.get(entry.targetId)?.toString() ?? entry.targetId;
					break;
				}
				case "StageInstance": {
					target =
						guild.stageInstances.cache.get(entry.targetId)?.toString() ??
						`<#${entry.targetId}>`;
					break;
				}
				case "Sticker": {
					target = guild.emojis.cache.get(entry.targetId)?.toString() ?? entry.targetId;
					break;
				}
				case "Thread": {
					target =
						(await guild.channels.fetchActiveThreads()).threads
							.get(entry.targetId)
							?.toString() ?? `<#${entry.targetId}>`;
					break;
				}
				case "User":
					target =
						guild.members.cache.get(entry.targetId)?.toString() ??
						`<@${entry.targetId}>`;
					break;
				case "Webhook":
			}
			embed.addFields(f(entry.targetType, target));
		}

		if (entry.reason) embed.addFields(f("Reason", entry.reason));

		if (entry.changes.length > 0) {
			switch (entry.actionType) {
				case "Create":
					embed.addFields(
						f(
							"Changes",
							`\`\`\`\n${entry.changes
								.map(change => `[${change.key}] ${change.new}`)
								.join("\n")}\`\`\``
						)
					);
					break;
				case "Update":
					embed.addFields(
						f(
							"Changes",
							`\`\`\`\n${entry.changes
								.map(change => `[${change.key}] ${change.old} -> ${change.new}`)
								.join("\n")}\`\`\``
						)
					);
					break;
				case "Delete":
			}
		}

		await logChannel.send({ embeds: [embed] });
	});
};
