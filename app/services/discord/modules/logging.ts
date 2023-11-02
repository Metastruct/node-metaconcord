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
		if (msg.channelId !== bot.config.channels.relay) bot.fixEmbeds(msg);
		await bot.feedMarkov(msg);
	});

	bot.discord.on("messageDelete", async msg => {
		if (!logChannel) return;
		msg = await bot.fetchPartial(msg);

		if (!msg.author?.username) return;

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
							.replaceAll("```", "​`​`​`")
							.substring(0, 1024 - 11)}\`\`\``;
				  })
				: undefined;

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: msg.author?.username ?? "unknown user",
				iconURL: msg.author?.avatarURL() ?? undefined,
			})
			.setColor(RED_COLOR)
			.addFields(f("Id", msg.id))
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
			embed.addFields(f("Attachment/s", attachments.join(" ").substring(0, 1024)));
		}

		if (embeds) {
			embed.addFields(f("Embed/s", embeds.join("\n").substring(0, 1024)));
		}

		if (msg.stickers.size > 0) {
			embed.addFields(f("Sticker/s", msg.stickers.map(sticker => sticker.url).join("\n")));
		}

		await logChannel.send({ embeds: [embed] });
	});

	bot.discord.on("messageUpdate", async (oldMsg, newMsg) => {
		if (!logChannel) return;

		oldMsg = oldMsg.partial ? await bot.fetchPartial(oldMsg) : oldMsg;
		newMsg = newMsg.partial ? await bot.fetchPartial(newMsg) : newMsg;

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
				? [true, true] // embed was changed
				: newMsg.embeds.length > 0 && oldMsg.embeds.length === 0
				? [true, false] // embed was added
				: newMsg.embeds.length === 0 && oldMsg.embeds.length > 0
				? [false, true] // embed was removed
				: [false, false]; // no embed was present at all

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
		diff = diff.replaceAll("```", "​`​`​`");

		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: user?.username ?? "unknown user",
				iconURL: user?.avatarURL() ?? undefined,
				url: newMsg.url,
			})
			.setColor(YELLOW_COLOR)
			.addFields(f("Id", oldMsg.id))
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
			.setAuthor({
				name: `${user.user.username} (${user.displayName})`,
				iconURL: user.avatarURL() ?? user.user.avatarURL() ?? undefined,
			})
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
		const actionName = Discord.AuditLogEvent[entry.action];
		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: `${user?.user.username} (${user?.displayName})` ?? "unknown user",
				iconURL: user?.avatarURL() ?? user?.user.avatarURL() ?? undefined,
			})
			.setFooter({
				text: `${actionName}${
					actionName !== entry.targetType + entry.actionType
						? ` (${entry.targetType} ${entry.actionType})`
						: ""
				}`,
			})
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
			const Id = entry.targetId;
			switch (entry.targetType) {
				case "ApplicationCommand": {
					const command =
						guild.commands.cache.get(Id) ?? (await guild.commands.fetch(Id).catch());
					target = command ? `</${command.name}:${command.id}>` : Id;
					break;
				}
				case "AutoModerationRule": {
					const rule =
						guild.autoModerationRules.cache.get(Id) ??
						(await guild.autoModerationRules.fetch(Id).catch());
					target = rule?.name ?? Id;
					break;
				}
				case "Channel": {
					const channel =
						guild.channels.cache.get(Id) ?? (await guild.channels.fetch(Id).catch());
					target = channel ? `${channel} (${Id})` : Id;
					break;
				}
				case "Emoji": {
					const emoji =
						guild.emojis.cache.get(Id) ?? (await guild.emojis.fetch(Id).catch());
					target = emoji ? `${emoji.name} (${Id})` : Id;
					break;
				}
				case "Guild": {
					target = Id === bot.config.bot.primaryGuildId ? "Meta Construct" : "wtf?????";
					break;
				}
				case "GuildScheduledEvent": {
					const event =
						guild.scheduledEvents.cache.get(Id) ??
						(await guild.scheduledEvents.fetch(Id).catch());
					target = event ? event.name : Id;
					break;
				}
				case "Integration": {
					const integration = (await guild.fetchIntegrations()).get(Id);
					target = integration ? `${integration.name} (${Id})` : Id;
					break;
				}
				case "Invite": {
					const invite =
						guild.invites.cache.get(Id) ?? (await guild.invites.fetch(Id).catch());
					target = invite ? `<@${invite.inviterId}> -> <#${invite.channelId}>` : Id;
					break;
				}
				case "Message": {
					target = Id;
					break;
				}
				case "Role": {
					const role = guild.roles.cache.get(Id) ?? (await guild.roles.fetch(Id).catch());
					target = role ? `${role.toString()} (${Id})` : Id;
					break;
				}
				case "StageInstance": {
					const stage =
						guild.stageInstances.cache.get(Id) ??
						(await guild.stageInstances.fetch(Id));
					target = stage ? `${stage} (${Id})` : Id;
					break;
				}
				case "Sticker": {
					const sticker =
						guild.emojis.cache.get(Id) ?? (await guild.emojis.fetch(Id).catch());
					target = sticker ? `${sticker.name} (${Id})` : Id;
					break;
				}
				case "Thread": {
					const thread = (await guild.channels.fetchActiveThreads()).threads.get(Id);
					target = thread ? `${thread} (${Id})` : Id;
					break;
				}
				case "User":
					const user =
						guild.members.cache.get(Id) ?? (await guild.client.users.fetch(Id).catch());
					target = (user && user.mention) ?? `<@${Id}>`;
					break;
				case "Webhook":
					const webhook = (await guild.fetchWebhooks()).find(h => h.id === Id);
					target = webhook
						? `${webhook.name} in ${webhook.channel?.toString()} created by: ${
								webhook.owner
						  }`
						: Id;
			}
			embed.addFields(f(entry.targetType, target));
		}

		if (entry.reason) embed.addFields(f("Reason", entry.reason));

		if (entry.changes.length > 0) {
			switch (entry.actionType) {
				case "Delete":
					embed.addFields(
						f(
							"Removed",
							`\`\`\`\n${entry.changes
								.map(
									change =>
										`[${change.key}] ${
											typeof change.old === "object"
												? JSON.stringify(change.old)
												: change.old?.toString() ?? ""
										}`
								)
								.join("\n")}\`\`\``
						)
					);
					break;
				case "Create":
					embed.addFields(
						f(
							"Added",
							`\`\`\`\n${entry.changes
								.map(
									change =>
										`[${change.key}] ${
											typeof change.new === "object"
												? JSON.stringify(change.new)
												: change.new?.toString() ?? ""
										}`
								)
								.join("\n")}\`\`\``
						)
					);
					break;
				case "Update":
					let diff = "";
					entry.changes.map(change => {
						diff += `[${change.key}] `;
						const diffList = diffWords(
							change.old?.toString() ?? "",
							typeof change.new === "object"
								? JSON.stringify(change.new)
								: change.new?.toString() ?? ""
						);
						for (const part of diffList) {
							diff += part.added
								? `\u001b[1;40m${part.value}\u001b[0;0m`
								: part.removed
								? `\u001b[1;30;41m${part.value}\u001b[0;0m`
								: part.value;
						}
					});
					diff = diff.replaceAll("```", "​`​`​`");
					embed.addFields(f("Changes", `\`\`\`ansi\n${diff.substring(0, 1010)}\n\`\`\``));
					break;
			}
		}

		await logChannel.send({ embeds: [embed] });
	});
};
