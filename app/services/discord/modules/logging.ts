import * as Discord from "discord.js";
import { DiscordBot } from "../index.js";
import { InspectOptions, inspect } from "node:util";
import { diffJson, diffWords } from "diff";
import { f } from "@/utils.js";

const RED_COLOR = Discord.Colors.Red;
const YELLOW_COLOR = Discord.Colors.Yellow;
const GREEN_COLOR = Discord.Colors.Green;

const DEFAULT_INSPECT_OPTIONS: InspectOptions = { colors: true, depth: 1 };

// Discord's ansi codeblock renderer only understands reset(0)/bold(1)/underline(4)
// plus the 30-37/40-47 color ranges. Node's inspect also emits codes like 22/39/49
// (partial resets) and 90-97 (bright colors) that it silently ignores, which leaves
// styling like bold "stuck on" for the rest of the block. Remap anything unsupported.
const toDiscordSafeAnsi = (text: string) =>
	// eslint-disable-next-line no-control-regex -- intentionally matching ESC (\u001b) ansi sequences
	text.replace(/\u001b\[(\d+)m/g, (_, codeStr: string) => {
		const code = Number(codeStr);
		if (code === 0 || code === 1 || code === 4) return `\u001b[${code}m`;
		if ((code >= 30 && code <= 37) || (code >= 40 && code <= 47)) return `\u001b[${code}m`;
		if (code >= 90 && code <= 97) return `\u001b[${code - 60}m`; // bright fg -> normal fg
		if (code >= 100 && code <= 107) return `\u001b[${code - 60}m`; // bright bg -> normal bg
		return "\u001b[0m"; // unsupported reset variants (22/24/39/49/...) -> full reset
	});

const format = (input: unknown, options?: InspectOptions) =>
	toDiscordSafeAnsi(inspect(input, options ?? DEFAULT_INSPECT_OPTIONS)).replaceAll(
		"```",
		"​`​`​`"
	);

const trimfield = (input: string, limit: number, isCodeBlock: boolean) =>
	input.length >= limit
		? input.substring(0, limit - (isCodeBlock ? 17 : 6)) +
			"\n. . ." +
			(isCodeBlock ? "```" : "")
		: input + (isCodeBlock ? "```" : "");

const hastoString = (obj: object | string | number | boolean) =>
	obj.toString === Object.prototype.toString;

// Collapses noisy Discord.js structures (e.g. Role.guild) down to "Name (id)"
const formatEntity = (value: unknown): string | undefined => {
	if (value instanceof Discord.Guild) return `Guild "${value.name}" (${value.id})`;
	if (value instanceof Discord.Role) return `Role "${value.name}" (${value.id})`;
	if (value instanceof Discord.GuildMember) return `Member ${value.user.tag} (${value.id})`;
	if (value instanceof Discord.User) return `User ${value.tag} (${value.id})`;
	if (value instanceof Discord.GuildChannel || value instanceof Discord.ThreadChannel)
		return `Channel #${value.name} (${value.id})`;
	return undefined;
};

const sanitizeEntity = (value: unknown, seen = new WeakSet<object>()): unknown => {
	const entity = formatEntity(value);
	if (entity) return entity;
	if (value && typeof value === "object") {
		if (seen.has(value)) return "[Circular]";
		seen.add(value);
		if (Array.isArray(value)) return value.map(v => sanitizeEntity(v, seen));
		const out: Record<string, unknown> = {};
		for (const [key, val] of Object.entries(value)) out[key] = sanitizeEntity(val, seen);
		return out;
	}
	return value;
};

// Permission overwrite changes carry raw bitfield strings/numbers and a
// numeric type (0 = role, 1 = member); decode those into readable text.
const formatOverwriteValue = (key: string, value: unknown): string | undefined => {
	if (
		(key === "allow" || key === "deny") &&
		(typeof value === "string" || typeof value === "number" || typeof value === "bigint")
	) {
		const perms = new Discord.PermissionsBitField(BigInt(value)).toArray();
		return perms.length > 0 ? perms.join(", ") : "None";
	}
	if (key === "type" && typeof value === "number") {
		return value === 0 ? "Role" : value === 1 ? "Member" : String(value);
	}
	return undefined;
};

export default (bot: DiscordBot): void => {
	let logChannel: Discord.TextChannel | undefined;

	bot.discord.once("clientReady", () => {
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

		const message = msg.content && msg.content.length > 0 ? msg.content : undefined;

		if (!msg.author && !message) return;

		const attachments =
			msg.attachments.size > 0
				? msg.attachments.map(a => {
						return `[${a.name}](${a.url})`;
					})
				: undefined;

		const embeds =
			msg.embeds.length > 0
				? msg.embeds.map(e => {
						const data = "```ansi\n" + format(e.data);
						return trimfield(data, 1024, true);
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
			.setFooter({ text: `${msg.system ? "System " : ""}Message Deleted` })
			.setTimestamp(msg.createdTimestamp);

		if (msg.author?.mention) {
			embed.addFields(f("Mention", msg.author?.mention));
		}
		if (message) {
			embed.addFields(f("Message", trimfield(message, 1024, false), true));
		}

		if (attachments) {
			embed.addFields(f("Attachment/s", trimfield(attachments.join(" "), 1024, false)));
		}

		if (embeds) {
			embed.addFields(f("Embed/s", trimfield(embeds.join("\n"), 1024, false)));
		}

		if (msg.stickers.size > 0) {
			embed.addFields(f("Sticker/s", msg.stickers.map(sticker => sticker.url).join("\n")));
		}

		await logChannel.send({ embeds: [embed] }).catch(() => {});
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

		const oldText = oldMsg.content ? trimfield(oldMsg.content, 1024, false) : "";
		const newText = newMsg.content ? trimfield(newMsg.content, 1024, false) : "";

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
					? `\u001b[1;42m${part.value}\u001b[0m`
					: part.removed
						? `\u001b[1;41m${part.value}\u001b[0m`
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
			.addFields(f("Difference", trimfield("```ansi\n" + diff, 1024, true)))
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

		await logChannel.send({ embeds: [embed] }).catch(() => {});
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
		if (user.joinedTimestamp)
			embed.addFields(
				f("Member since", `<t:${user.joinedTimestamp.toString().substring(0, 10)}:D>`)
			);
		await logChannel.send({ embeds: [embed] }).catch(() => {});
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
		await logChannel.send({ embeds: [embed] }).catch(() => {});
	});

	bot.discord.on("guildAuditLogEntryCreate", async (entry, guild) => {
		if (!logChannel) return;
		if (!entry.executorId) return;
		const member = guild.members.cache.get(entry.executorId);
		const executor = entry.executor ?? member?.user;
		const actionName = Discord.AuditLogEvent[entry.action];
		const embed = new Discord.EmbedBuilder()
			.setAuthor({
				name: member
					? `${executor?.username} (${member.displayName})`
					: (executor?.username ?? "unknown user"),
				iconURL: member?.avatarURL() ?? executor?.avatarURL() ?? undefined,
			})
			.setFooter({
				text: `${actionName ?? entry.action}${
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

		const mention = member?.mention ?? (executor ? `<@${executor.id}>` : undefined);
		if (mention) embed.addFields(f("Mention", mention));

		if (entry.targetId) {
			const targetString =
				entry.target && entry.target.toString() !== "[object Object]"
					? entry.target.toString()
					: entry.targetType === "User"
						? `<@${entry.targetId}>`
						: "";
			embed.addFields(f(`${entry.targetType} (${entry.targetId})`, targetString));
		}

		if (entry.reason) embed.addFields(f("Reason", entry.reason));

		if (entry.changes.length > 0) {
			switch (entry.actionType) {
				case "Delete":
					embed.addFields(
						f(
							"Removed",
							`\`\`\`ansi\n${entry.changes
								.map(
									change =>
										`${change.key}: ${
											formatOverwriteValue(change.key, change.old) ??
											format(sanitizeEntity(change.old))
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
							`\`\`\`ansi\n${entry.changes
								.map(
									change =>
										`${change.key}: ${
											formatOverwriteValue(change.key, change.new) ??
											format(sanitizeEntity(change.new))
										}`
								)
								.join("\n")}\`\`\``
						)
					);
					break;
				case "Update": {
					const changes = entry.changes
						.map(change => {
							// $add/$remove (role changes) list roles rather than
							// diffing an old/new value, so handle them separately.
							if (change.key === "$add" || change.key === "$remove") {
								const roles = (change.new ?? change.old ?? []) as {
									id: string;
									name: string;
								}[];
								const list =
									roles.length > 0
										? roles.map(r => `${r.name} (${r.id})`).join(", ")
										: "none";
								return change.key === "$add"
									? `\u001b[1;42m+ Added roles\u001b[0m: ${list}`
									: `\u001b[1;41m- Removed roles\u001b[0m: ${list}`;
							}

							const overwriteOld = formatOverwriteValue(change.key, change.old);
							const overwriteNew = formatOverwriteValue(change.key, change.new);

							let changef = `${change.key}: `;
							const isObject =
								overwriteOld === undefined &&
								overwriteNew === undefined &&
								typeof change.new === "object";
							const diffList =
								overwriteOld !== undefined || overwriteNew !== undefined
									? diffWords(overwriteOld ?? "none", overwriteNew ?? "none")
									: typeof change.old === "object" &&
										  typeof change.new === "object"
										? diffJson(
												JSON.stringify(sanitizeEntity(change.old), null, 2),
												JSON.stringify(sanitizeEntity(change.new), null, 2)
											)
										: diffWords(
												change.old && hastoString(change.old)
													? change.old.toString()
													: (format(sanitizeEntity(change.old), {
															colors: false,
														}) ?? "undefined"),
												change.new && hastoString(change.new)
													? change.new.toString()
													: (format(sanitizeEntity(change.new), {
															colors: false,
														}) ?? "undefined")
											);
							for (const part of diffList) {
								changef += part.added
									? `\u001b[1;42m${part.value}\u001b[0m`
									: part.removed
										? `\u001b[1;41m${part.value}\u001b[0m`
										: isObject
											? "" // skip value printing on object comparison
											: part.value;
							}
							return changef;
						})
						.join("\n");
					embed.addFields(f("Changes", trimfield("```ansi\n" + changes, 1024, true)));
					break;
				}
			}
		}

		if (entry.extra) {
			const extra = "```ansi\n" + format(sanitizeEntity(entry.extra));
			embed.addFields(f("Extra", trimfield(extra, 1024, true)));
		}

		await logChannel.send({ embeds: [embed] }).catch(() => {});
	});
};
