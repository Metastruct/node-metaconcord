#!/usr/bin/env node
// One-off mirror: create config/discord.json roles + channels in the Fluxer guild.
// Reads config/discord.json (Discord side) + config/fluxer.json (Fluxer side).
// Usage: node scripts/mirror.mjs [--dry-run] [--yes]
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const assumeYes = args.has("--yes");

const discordConfig = JSON.parse(await readFile(resolve(root, "config/discord.json"), "utf8"));
const fluxerConfig = JSON.parse(await readFile(resolve(root, "config/fluxer.json"), "utf8"));

const DISCORD_API = "https://discord.com/api/v10";
const FLUXER_API = fluxerConfig.apiBaseUrl;
const DISCORD_GUILD = discordConfig.bot.primaryGuildId;
const FLUXER_GUILD = fluxerConfig.guildId;
const FLUXER_EVERYONE = FLUXER_GUILD; // @everyone snowflake == guild snowflake
const DISCORD_EVERYONE = DISCORD_GUILD;

// Discord permission bit -> name (only entries Fluxer could ever map)
const DISCORD_PERM_BITS = [
	[0, "CREATE_INSTANT_INVITE"],
	[1, "KICK_MEMBERS"],
	[2, "BAN_MEMBERS"],
	[3, "ADMINISTRATOR"],
	[4, "MANAGE_CHANNELS"],
	[5, "MANAGE_GUILD"],
	[6, "ADD_REACTIONS"],
	[7, "VIEW_AUDIT_LOG"],
	[8, "PRIORITY_SPEAKER"],
	[9, "STREAM"],
	[10, "VIEW_CHANNEL"],
	[11, "SEND_MESSAGES"],
	[12, "SEND_TTS_MESSAGES"],
	[13, "MANAGE_MESSAGES"],
	[14, "EMBED_LINKS"],
	[15, "ATTACH_FILES"],
	[16, "READ_MESSAGE_HISTORY"],
	[17, "MENTION_EVERYONE"],
	[18, "USE_EXTERNAL_EMOJIS"],
	[20, "CONNECT"],
	[21, "SPEAK"],
	[22, "MUTE_MEMBERS"],
	[23, "DEAFEN_MEMBERS"],
	[24, "MOVE_MEMBERS"],
	[25, "USE_VAD"],
	[26, "CHANGE_NICKNAME"],
	[27, "MANAGE_NICKNAMES"],
	[28, "MANAGE_ROLES"],
	[29, "MANAGE_WEBHOOKS"],
	[30, "MANAGE_GUILD_EXPRESSIONS"],
	[34, "USE_EXTERNAL_STICKERS"],
	[37, "MODERATE_MEMBERS"],
];

// Discord permission name -> Fluxer permission name
const PERM_MAP = {
	CREATE_INSTANT_INVITE: "CREATE_INSTANT_INVITE",
	KICK_MEMBERS: "KICK_MEMBERS",
	BAN_MEMBERS: "BAN_MEMBERS",
	ADMINISTRATOR: "ADMINISTRATOR",
	MANAGE_CHANNELS: "MANAGE_CHANNELS",
	MANAGE_GUILD: "MANAGE_GUILD",
	ADD_REACTIONS: "ADD_REACTIONS",
	VIEW_AUDIT_LOG: "VIEW_AUDIT_LOG",
	PRIORITY_SPEAKER: "PRIORITY_SPEAKER",
	STREAM: "STREAM",
	VIEW_CHANNEL: "VIEW_CHANNEL",
	SEND_MESSAGES: "SEND_MESSAGES",
	SEND_TTS_MESSAGES: "SEND_TTS_MESSAGES",
	MANAGE_MESSAGES: "MANAGE_MESSAGES",
	EMBED_LINKS: "EMBED_LINKS",
	ATTACH_FILES: "ATTACH_FILES",
	READ_MESSAGE_HISTORY: "READ_MESSAGE_HISTORY",
	MENTION_EVERYONE: "MENTION_EVERYONE",
	USE_EXTERNAL_EMOJIS: "USE_EXTERNAL_EMOJIS",
	CONNECT: "CONNECT",
	SPEAK: "SPEAK",
	MUTE_MEMBERS: "MUTE_MEMBERS",
	DEAFEN_MEMBERS: "DEAFEN_MEMBERS",
	MOVE_MEMBERS: "MOVE_MEMBERS",
	USE_VAD: "USE_VAD",
	CHANGE_NICKNAME: "CHANGE_NICKNAME",
	MANAGE_NICKNAMES: "MANAGE_NICKNAMES",
	MANAGE_ROLES: "MANAGE_ROLES",
	MANAGE_WEBHOOKS: "MANAGE_WEBHOOKS",
	MANAGE_GUILD_EXPRESSIONS: "MANAGE_EXPRESSIONS",
	USE_EXTERNAL_STICKERS: "USE_EXTERNAL_STICKERS",
	MODERATE_MEMBERS: "MODERATE_MEMBERS",
};

// Fluxer permission name -> bit
const FLUXER_PERM_BITS = {};
for (const [bit, name] of [
	[0, "CREATE_INSTANT_INVITE"],
	[1, "KICK_MEMBERS"],
	[2, "BAN_MEMBERS"],
	[3, "ADMINISTRATOR"],
	[4, "MANAGE_CHANNELS"],
	[5, "MANAGE_GUILD"],
	[6, "ADD_REACTIONS"],
	[7, "VIEW_AUDIT_LOG"],
	[8, "PRIORITY_SPEAKER"],
	[9, "STREAM"],
	[10, "VIEW_CHANNEL"],
	[11, "SEND_MESSAGES"],
	[12, "SEND_TTS_MESSAGES"],
	[13, "MANAGE_MESSAGES"],
	[14, "EMBED_LINKS"],
	[15, "ATTACH_FILES"],
	[16, "READ_MESSAGE_HISTORY"],
	[17, "MENTION_EVERYONE"],
	[18, "USE_EXTERNAL_EMOJIS"],
	[20, "CONNECT"],
	[21, "SPEAK"],
	[22, "MUTE_MEMBERS"],
	[23, "DEAFEN_MEMBERS"],
	[24, "MOVE_MEMBERS"],
	[25, "USE_VAD"],
	[26, "CHANGE_NICKNAME"],
	[27, "MANAGE_NICKNAMES"],
	[28, "MANAGE_ROLES"],
	[29, "MANAGE_WEBHOOKS"],
	[30, "MANAGE_EXPRESSIONS"],
	[37, "USE_EXTERNAL_STICKERS"],
	[40, "MODERATE_MEMBERS"],
	[43, "CREATE_EXPRESSIONS"],
	[51, "PIN_MESSAGES"],
	[52, "BYPASS_SLOWMODE"],
	[53, "UPDATE_RTC_REGION"],
	[54, "VIEW_CHANNEL_MEMBERS"],
]) {
	FLUXER_PERM_BITS[name] = bit;
}

// Discord mask (decimal string or int) -> Fluxer mask
function mask(discordMask) {
	let out = 0n;
	const value = BigInt(discordMask);
	for (const [bit, name] of DISCORD_PERM_BITS) {
		if (value & (1n << BigInt(bit))) {
			const to = PERM_MAP[name];
			if (to != null && FLUXER_PERM_BITS[to] != null) {
				out |= 1n << BigInt(FLUXER_PERM_BITS[to]);
			}
		}
	}
	return out.toString();
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function discordApi(path) {
	const res = await fetch(`${DISCORD_API}${path}`, {
		headers: { Authorization: `Bot ${discordConfig.bot.token}` },
	});
	if (!res.ok) throw new Error(`Discord ${res.status} ${path}: ${await res.text()}`);
	return res.json();
}

async function fluxerApi(method, path, body, { retries = 5 } = {}) {
	for (let attempt = 0; ; attempt++) {
		const res = await fetch(`${FLUXER_API}${path}`, {
			method,
			headers: {
				Authorization: `Bot ${fluxerConfig.botToken}`,
				...(body != null ? { "Content-Type": "application/json" } : {}),
			},
			...(body != null ? { body: JSON.stringify(body) } : {}),
		});
		if (res.status === 429 && attempt < retries) {
			const retryAfter = Number(res.headers.get("Retry-After") ?? 1) * 1000;
			await sleep(retryAfter);
			continue;
		}
		if (!res.ok) {
			const text = await res.text();
			throw new Error(`Fluxer ${method} ${res.status} ${path}: ${text}`);
		}
		if (res.status === 204) return null;
		return res.json();
	}
}

const log = (...args) => console.log(...args);
const phase = msg => log(`\n== ${msg} ==`);
const step = msg => log(`  - ${msg}`);
const warn = msg => log(`  ! ${msg}`);

// ---------------------------------------------------------------- fetch source
phase("Fetching Discord source data");
const [discordRoles, discordChannels] = await Promise.all([
	discordApi(`/guilds/${DISCORD_GUILD}/roles`),
	discordApi(`/guilds/${DISCORD_GUILD}/channels`),
]);
const roleById = new Map(discordRoles.map(r => [r.id, r]));
const channelById = new Map(discordChannels.map(c => [c.id, c]));
for (const threadId of Object.values(discordConfig.threads)) {
	if (channelById.has(threadId)) continue;
	const thread = await discordApi(`/channels/${threadId}`);
	channelById.set(threadId, thread);
}

// ---------------------------------------------------------------- build plan
const FLUXER_CHANNEL_TYPE = {
	0: 0, // GUILD_TEXT
	2: 2, // GUILD_VOICE
	4: 4, // GUILD_CATEGORY
	5: 0, // GUILD_ANNOUNCEMENT -> text
	11: 0, // GUILD_PUBLIC_THREAD -> text
	13: 2, // GUILD_STAGE_VOICE -> voice
	15: 0, // GUILD_FORUM -> text
};

const desiredRoles = [];
for (const [configName, discordId] of Object.entries(discordConfig.roles)) {
	if (discordId === "865335481596510228") continue; // vaccination: one-time, skip
	if (!roleById.has(discordId)) {
		warn(`role ${configName} (${discordId}) missing from Discord, skipping`);
		continue;
	}
	const src = roleById.get(discordId);
	desiredRoles.push({ configName, srcId: discordId, ...src });
}

// Channels + threads + categories from config, deduped by id.
const desiredChannels = new Map();
const desiredCategories = new Map();
const addChannel = (discordId, configName) => {
	if (!channelById.has(discordId)) {
		warn(`channel ${configName} (${discordId}) missing from Discord`);
		return;
	}
	const src = channelById.get(discordId);
	const type = FLUXER_CHANNEL_TYPE[src.type];
	if (type == null) {
		warn(`channel ${configName} (${discordId}) unsupported type ${src.type}, skipping`);
		return;
	}
	if (src.type === 4) {
		desiredCategories.set(discordId, src);
		return;
	}
	// Resolve the Discord parent chain to a category channel (may need creating).
	let parentDiscordId = src.parent_id;
	if (parentDiscordId) {
		let parent = channelById.get(parentDiscordId);
		// Threads nest under a text/forum channel; use that channel's category.
		while (parent && parent.type !== 4) {
			parent = parent.parent_id ? channelById.get(parent.parent_id) : undefined;
		}
		if (parent) parentDiscordId = parent.id;
		else parentDiscordId = null;
	} else {
		parentDiscordId = null;
	}
	if (parentDiscordId) {
		const parent = channelById.get(parentDiscordId);
		desiredCategories.set(parentDiscordId, parent);
	}
	desiredChannels.set(discordId, {
		configName,
		src,
		type,
		parentDiscordId,
	});
};

const expandedCategoryNames = new Set([
	"INFORMATION",
	"VOICE CHATS",
	"CHATS",
	"GAMING",
	"Chat Relays",
	"DEV AREA",
]);
for (const src of discordChannels) {
	if (src.type === 4) continue;
	const parent = src.parent_id ? channelById.get(src.parent_id) : null;
	if (parent && expandedCategoryNames.has(parent.name)) {
		addChannel(src.id, `category:${src.name}`);
	}
}
for (const [configName, discordId] of Object.entries(discordConfig.channels)) {
	if (discordId === "123") {
		warn(`channel ${configName}: placeholder id "123", skipping`);
		continue;
	}
	// config lists "relay" and "ingameChat" with the same id; dedupe below.
	addChannel(discordId, configName);
}
for (const [configName, discordId] of Object.entries(discordConfig.threads)) {
	addChannel(discordId, configName);
}
for (const [configName, discordId] of Object.entries(discordConfig.categories)) {
	addChannel(discordId, configName);
}

const channelPosition = ch => {
	if (ch.src.type !== 11) return ch.src.position ?? 0;
	const threadParent = ch.src.parent_id ? channelById.get(ch.src.parent_id) : null;
	return (threadParent?.position ?? 0) + 0.5;
};
const compareChannels = (a, b) => {
	// Fluxer groups text channels before voice channels within each category.
	if (a.type !== b.type) return a.type === 0 ? -1 : 1;
	return channelPosition(a) - channelPosition(b);
};

// ---------------------------------------------------------------- Fluxer state
phase("Fetching Fluxer current state");
let fluxerGuild = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}`);
const [fluxerRoles, fluxerChannels, fluxerMember] = await Promise.all([
	fluxerApi("GET", `/guilds/${FLUXER_GUILD}/roles`),
	fluxerApi("GET", `/guilds/${FLUXER_GUILD}/channels`),
	fluxerApi("GET", `/guilds/${FLUXER_GUILD}/members/@me`),
]);
const administratorRole = desiredRoles.find(r => r.configName === "administrator");
const stockAdministrator = fluxerRoles.find(
	r =>
		fluxerMember.roles.includes(r.id) &&
		r.name === administratorRole?.name &&
		(BigInt(r.permissions) & (1n << 3n)) !== 0n
);
if (!administratorRole || !stockAdministrator) {
	throw new Error("Could not identify the bot's existing Fluxer Administrator role");
}
const fluxerRoleByName = new Map(
	fluxerRoles
		.filter(r => r.id !== FLUXER_EVERYONE && r.id !== stockAdministrator.id)
		.map(r => [r.name, r])
);

// ---------------------------------------------------------------- print plan
phase("Plan");
log(`Guild: "${fluxerGuild.name}" (${FLUXER_GUILD})`);
log(`Roles to mirror (${desiredRoles.length}):`);
for (const r of desiredRoles) {
	const existing =
		r.srcId === administratorRole.srcId ? stockAdministrator : fluxerRoleByName.get(r.name);
	log(
		`  - ${r.configName}: "${r.name}" perms=${r.permissions} (${existing ? "reuse" : "create"})`
	);
}
log(
	`Categories to mirror (${desiredCategories.size}): ` +
		[...desiredCategories.values()].map(c => `"${c.name}"`).join(", ")
);
log(`Channels to mirror (${desiredChannels.size}):`);
const catOrder = [...desiredCategories.values()].sort((a, b) => a.position - b.position);
for (const cat of catOrder) {
	log(`  [category] ${cat.name}`);
	for (const ch of [...desiredChannels.values()]
		.filter(ch => ch.parentDiscordId === cat.id)
		.sort(compareChannels)) {
		log(
			`    - ${ch.configName}: "${ch.src.name}" (discord type ${ch.src.type} -> fluxer ${ch.type})`
		);
	}
}

// ---------------------------------------------------------------- confirm
if (dryRun) {
	log("\nDRY RUN - no changes made.");
	process.exit(0);
}
if (!assumeYes) {
	const { createInterface } = await import("node:readline/promises");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`\nApply this mirror to "${fluxerGuild.name}"? (y/N) `);
	rl.close();
	if (!/^y/i.test(answer)) {
		log("Aborted.");
		process.exit(1);
	}
}

// ---------------------------------------------------------------- features
phase("Enabling TEXT_CHANNEL_FLEXIBLE_NAMES");
if (!fluxerGuild.features.includes("TEXT_CHANNEL_FLEXIBLE_NAMES")) {
	const features = [...new Set([...fluxerGuild.features, "TEXT_CHANNEL_FLEXIBLE_NAMES"])];
	if (dryRun) step(`would PATCH features: ${features.join(", ")}`);
	else {
		fluxerGuild = await fluxerApi("PATCH", `/guilds/${FLUXER_GUILD}`, { features });
		step("done");
	}
} else {
	step("already present");
}

// ---------------------------------------------------------------- roles
phase("Mirroring roles");
const fluxerIdByDiscordRole = new Map([[administratorRole.srcId, stockAdministrator.id]]);
step(`reusing bot Administrator role "${stockAdministrator.name}" (${stockAdministrator.id})`);
const everyone = discordRoles.find(r => r.id === DISCORD_EVERYONE);
if (everyone) {
	const fluxerEveryone = fluxerRoles.find(r => r.id === FLUXER_EVERYONE);
	const viewChannelMembers = 1n << BigInt(FLUXER_PERM_BITS.VIEW_CHANNEL_MEMBERS);
	const permissions =
		BigInt(mask(everyone.permissions)) |
		(BigInt(fluxerEveryone?.permissions ?? 0) & viewChannelMembers);
	const body = { color: everyone.color, permissions: permissions.toString() };
	if (dryRun) step(`PATCH @everyone ${JSON.stringify(body)}`);
	else {
		await fluxerApi("PATCH", `/guilds/${FLUXER_GUILD}/roles/${FLUXER_EVERYONE}`, body);
		step("PATCHed @everyone color+permissions");
	}
}

const manageableRoles = desiredRoles
	.filter(r => r.srcId !== administratorRole.srcId)
	.sort((a, b) => a.position - b.position);
for (const r of manageableRoles) {
	let fluxerRole = fluxerRoleByName.get(r.name);
	if (!fluxerRole) {
		const body = { name: r.name, color: r.color, permissions: mask(r.permissions) };
		fluxerRole = await fluxerApi("POST", `/guilds/${FLUXER_GUILD}/roles`, body);
		await sleep(6200); // role:create is 10/min
		step(`created role "${r.name}" (${fluxerRole.id})`);
	} else {
		step(`reusing existing role "${r.name}" (${fluxerRole.id})`);
	}
	fluxerIdByDiscordRole.set(r.srcId, fluxerRole.id);
	await fluxerApi("PATCH", `/guilds/${FLUXER_GUILD}/roles/${fluxerRole.id}`, {
		name: r.name,
		color: r.color,
		permissions: mask(r.permissions),
		hoist: r.hoist,
		mentionable: r.mentionable,
	});
	await sleep(600);
	step(`updated role "${r.name}"`);
}

if (manageableRoles.length > 0) {
	const ordered = manageableRoles.map((r, i) => ({
		id: fluxerIdByDiscordRole.get(r.srcId),
		position: i + 1,
	}));
	await fluxerApi("PATCH", `/guilds/${FLUXER_GUILD}/roles`, ordered);
	step(`reordered ${ordered.length} roles by Discord position`);
}

// ---------------------------------------------------------------- channels
phase("Mirroring channels");
const fluxerIdByDiscordChannel = new Map();
// Existing fluxer channels keyed by name for idempotent re-runs.
const fluxerCategoryByName = new Map(
	fluxerChannels.filter(c => c.type === 4).map(c => [c.name, c])
);
const fluxerChannelByName = new Map(fluxerChannels.filter(c => c.type !== 4).map(c => [c.name, c]));

const overwritesFor = srcChannel => {
	const out = [];
	for (const ow of srcChannel.permission_overwrites ?? []) {
		if (ow.type !== 0) continue; // member overwrites: not mirrored
		let fluxerId;
		if (ow.id === DISCORD_EVERYONE) {
			fluxerId = FLUXER_EVERYONE;
		} else {
			fluxerId = fluxerIdByDiscordRole.get(ow.id);
		}
		if (!fluxerId) continue; // role not mirrored
		out.push({
			id: fluxerId,
			type: 0,
			allow: mask(ow.allow ?? 0),
			deny: mask(ow.deny ?? 0),
		});
	}
	return out;
};

const readOnlyOverwritesFor = srcChannel => {
	const parent = srcChannel.parent_id ? channelById.get(srcChannel.parent_id) : null;
	const permissionSource =
		(srcChannel.permission_overwrites ?? []).length > 0 ? srcChannel : parent;
	const sendMessages = 1n << BigInt(FLUXER_PERM_BITS.SEND_MESSAGES);
	const overwrites = overwritesFor(permissionSource ?? srcChannel).map(overwrite => ({
		...overwrite,
		allow: (BigInt(overwrite.allow) & ~sendMessages).toString(),
		deny: (
			BigInt(overwrite.deny) | (overwrite.id === FLUXER_EVERYONE ? sendMessages : 0n)
		).toString(),
	}));
	if (!overwrites.some(overwrite => overwrite.id === FLUXER_EVERYONE)) {
		overwrites.push({
			id: FLUXER_EVERYONE,
			type: 0,
			allow: "0",
			deny: sendMessages.toString(),
		});
	}
	return overwrites;
};

const createChannel = (src, type, parentFluxerId) => {
	const body = {
		type,
		name: src.name,
		...(src.topic != null ? { topic: src.topic } : {}),
		...(parentFluxerId ? { parent_id: parentFluxerId } : {}),
		...(src.rate_limit_per_user != null
			? { rate_limit_per_user: src.rate_limit_per_user }
			: {}),
		...(type === 2 ? { bitrate: src.bitrate ?? 64000 } : {}),
		...(type === 2 ? { user_limit: Math.min(src.user_limit ?? 0, 99) } : {}),
	};
	const overwrites = overwritesFor(src);
	if (overwrites.length > 0) body.permission_overwrites = overwrites;
	return body;
};

for (const cat of catOrder) {
	const type = FLUXER_CHANNEL_TYPE[cat.type];
	if (dryRun) {
		step(`[dry] would create category "${cat.name}"`);
	} else {
		let fluxerCategory = fluxerCategoryByName.get(cat.name);
		if (!fluxerCategory) {
			const body = createChannel(cat, type, null);
			fluxerCategory = await fluxerApi("POST", `/guilds/${FLUXER_GUILD}/channels`, body);
			await sleep(6200); // channel:create is 10/min
			fluxerCategoryByName.set(cat.name, fluxerCategory);
			step(`created category "${cat.name}" (${fluxerCategory.id})`);
		} else {
			step(`reusing existing category "${cat.name}" (${fluxerCategory.id})`);
		}
		fluxerIdByDiscordChannel.set(cat.id, fluxerCategory.id);
	}
}

// Create channels in source category and channel order; the explicit reorder below
// also repairs ordering on idempotent reruns.
const orderedChannels = [...desiredChannels.values()].sort((a, b) => {
	const parentA = desiredCategories.get(a.parentDiscordId)?.position ?? 0;
	const parentB = desiredCategories.get(b.parentDiscordId)?.position ?? 0;
	if (parentA !== parentB) return parentA - parentB;
	return compareChannels(a, b);
});

for (const ch of orderedChannels) {
	const categoryFluxerId = ch.parentDiscordId
		? fluxerIdByDiscordChannel.get(ch.parentDiscordId)
		: null;
	const body = createChannel(ch.src, ch.type, categoryFluxerId);
	if (dryRun) {
		step(`[dry] would create channel "${ch.src.name}" ${JSON.stringify(body)}`);
		continue;
	}
	const existing = fluxerChannelByName.get(ch.src.name);
	if (existing && (existing.parent_id ?? null) === (categoryFluxerId ?? null)) {
		fluxerIdByDiscordChannel.set(ch.src.id, existing.id);
		step(`reusing existing channel "${ch.src.name}" (${existing.id})`);
		continue;
	}
	const created = await fluxerApi("POST", `/guilds/${FLUXER_GUILD}/channels`, body);
	await sleep(6200);
	fluxerIdByDiscordChannel.set(ch.src.id, created.id);
	step(`created channel "${ch.src.name}" (${created.id})`);
}

phase("Reconciling channel topics and access");
const fluxerChannelForName = name => {
	const source = [...desiredChannels.values()].find(ch => ch.src.name === name);
	return source ? fluxerIdByDiscordChannel.get(source.src.id) : null;
};
const forumFallbacks = new Map([
	["gaming", "gaming-chat"],
	["development", "dev-chat"],
	["post-your-stuff", "art-chat"],
]);
const translateTopic = topic => {
	if (topic == null) return null;
	return topic
		.replace(/<#(\d+)>/g, (_match, discordId) => {
			const fluxerId = fluxerIdByDiscordChannel.get(discordId);
			if (fluxerId) return `<#${fluxerId}>`;
			return `#${channelById.get(discordId)?.name ?? "unknown-channel"}`;
		})
		.replace(
			/https?:\/\/(?:canary\.|ptb\.)?discord(?:app)?\.com\/channels\/(\d+)\/(\d+)/g,
			(match, _guildId, discordId) => {
				const fluxerId = fluxerIdByDiscordChannel.get(discordId);
				return fluxerId
					? `https://chat.metastruct.net/channels/${FLUXER_GUILD}/${fluxerId}`
					: match;
			}
		);
};
const normalizeOverwrites = overwrites =>
	[...(overwrites ?? [])]
		.map(overwrite => ({
			id: overwrite.id,
			type: overwrite.type,
			allow: String(overwrite.allow ?? 0),
			deny: String(overwrite.deny ?? 0),
		}))
		.sort((a, b) => a.id.localeCompare(b.id));
const currentFluxerChannels = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/channels`);
const currentFluxerChannelById = new Map(
	currentFluxerChannels.map(channel => [channel.id, channel])
);
for (const ch of orderedChannels) {
	const fluxerId = fluxerIdByDiscordChannel.get(ch.src.id);
	const current = currentFluxerChannelById.get(fluxerId);
	const fallbackName = ch.src.type === 15 ? forumFallbacks.get(ch.src.name) : null;
	const archivedThread =
		ch.src.type === 11 &&
		(ch.src.thread_metadata?.archived === true || ch.src.thread_metadata?.locked === true);
	let topic = translateTopic(ch.src.topic);
	if (fallbackName) {
		const fallbackId = fluxerChannelForName(fallbackName);
		if (!fallbackId) throw new Error(`Missing Fluxer fallback channel "${fallbackName}"`);
		const notice =
			`Forum channels are not supported on Fluxer. Continue in <#${fallbackId}> ` +
			`or use the Discord forum: https://discord.com/channels/${DISCORD_GUILD}/${ch.src.id}`;
		topic = topic ? `${notice}\n\n${topic}` : notice;
	} else if (archivedThread) {
		const notice = "This Discord thread is archived and read-only on Fluxer.";
		topic = topic ? `${notice}\n\n${topic}` : notice;
	}

	const body = {};
	if ((current?.topic ?? null) !== topic) body.topic = topic;
	if (fallbackName || archivedThread) {
		const permissionOverwrites = readOnlyOverwritesFor(ch.src);
		if (
			JSON.stringify(normalizeOverwrites(current?.permission_overwrites)) !==
			JSON.stringify(normalizeOverwrites(permissionOverwrites))
		) {
			body.permission_overwrites = permissionOverwrites;
		}
	}
	if (Object.keys(body).length === 0) continue;
	await fluxerApi("PATCH", `/channels/${fluxerId}`, body);
	await sleep(600);
	step(`updated topic/access for "${ch.src.name}"`);
}

phase("Ordering channels");
const positionUpdates = [];
let precedingCategoryId = null;
for (const cat of catOrder) {
	const categoryId = fluxerIdByDiscordChannel.get(cat.id);
	positionUpdates.push({
		id: categoryId,
		parent_id: null,
		preceding_sibling_id: precedingCategoryId,
	});
	precedingCategoryId = categoryId;

	let precedingChannelId = null;
	const children = [...desiredChannels.values()]
		.filter(ch => ch.parentDiscordId === cat.id)
		.sort(compareChannels);
	for (const child of children) {
		const channelId = fluxerIdByDiscordChannel.get(child.src.id);
		positionUpdates.push({
			id: channelId,
			parent_id: categoryId,
			preceding_sibling_id: precedingChannelId,
		});
		precedingChannelId = channelId;
	}
}
await fluxerApi("PATCH", `/guilds/${FLUXER_GUILD}/channels`, positionUpdates);
step(`reordered ${positionUpdates.length} categories and channels`);

phase("Persisting bridge mappings");
const bridgeChannelMappings = [];
const bridgeRoleMappings = [];
const database = await open({
	driver: sqlite3.Database,
	filename: process.env.METACONCORD_DB_PATH ?? resolve(root, "metaconcord.db"),
});
await database.exec(`
	CREATE TABLE IF NOT EXISTS fluxer_channel_mappings (
		discord_channel_id TEXT PRIMARY KEY,
		fluxer_channel_id TEXT NOT NULL UNIQUE,
		discord_parent_id TEXT,
		channel_kind TEXT NOT NULL,
		relay_enabled INTEGER NOT NULL DEFAULT 0 CHECK (relay_enabled IN (0, 1)),
		updated_at_ms INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS fluxer_role_mappings (
		discord_role_id TEXT PRIMARY KEY,
		fluxer_role_id TEXT NOT NULL UNIQUE,
		updated_at_ms INTEGER NOT NULL
	);
`);
await database.exec("BEGIN IMMEDIATE");
try {
	const updatedAt = Date.now();
	await database.run("DELETE FROM fluxer_channel_mappings");
	for (const cat of catOrder) {
		const mapping = {
			discordChannelId: cat.id,
			fluxerChannelId: fluxerIdByDiscordChannel.get(cat.id),
			discordParentId: null,
			channelKind: "category",
			relayEnabled: false,
		};
		bridgeChannelMappings.push(mapping);
		await database.run(
			`INSERT INTO fluxer_channel_mappings
				(discord_channel_id, fluxer_channel_id, discord_parent_id, channel_kind, relay_enabled, updated_at_ms)
			 VALUES (?, ?, NULL, 'category', 0, ?)
			 ON CONFLICT(discord_channel_id) DO UPDATE SET
				fluxer_channel_id = excluded.fluxer_channel_id,
				discord_parent_id = excluded.discord_parent_id,
				channel_kind = excluded.channel_kind,
				relay_enabled = excluded.relay_enabled,
				updated_at_ms = excluded.updated_at_ms`,
			mapping.discordChannelId,
			mapping.fluxerChannelId,
			updatedAt
		);
	}
	for (const ch of orderedChannels) {
		const archivedThread =
			ch.src.type === 11 &&
			(ch.src.thread_metadata?.archived === true || ch.src.thread_metadata?.locked === true);
		const channelKind =
			ch.src.type === 15
				? "forum_placeholder"
				: ch.src.type === 11
					? archivedThread
						? "archived_thread"
						: "thread"
					: ch.type === 2
						? "voice"
						: "text";
		const relayEnabled = ch.type === 0 && ch.src.type !== 15 && !archivedThread ? 1 : 0;
		const mapping = {
			discordChannelId: ch.src.id,
			fluxerChannelId: fluxerIdByDiscordChannel.get(ch.src.id),
			discordParentId: ch.src.parent_id ?? null,
			channelKind,
			relayEnabled: relayEnabled === 1,
		};
		bridgeChannelMappings.push(mapping);
		await database.run(
			`INSERT INTO fluxer_channel_mappings
				(discord_channel_id, fluxer_channel_id, discord_parent_id, channel_kind, relay_enabled, updated_at_ms)
			 VALUES (?, ?, ?, ?, ?, ?)
			 ON CONFLICT(discord_channel_id) DO UPDATE SET
				fluxer_channel_id = excluded.fluxer_channel_id,
				discord_parent_id = excluded.discord_parent_id,
				channel_kind = excluded.channel_kind,
				relay_enabled = excluded.relay_enabled,
				updated_at_ms = excluded.updated_at_ms`,
			mapping.discordChannelId,
			mapping.fluxerChannelId,
			mapping.discordParentId,
			mapping.channelKind,
			relayEnabled,
			updatedAt
		);
	}
	await database.run("DELETE FROM fluxer_role_mappings");
	for (const [discordRoleId, fluxerRoleId] of fluxerIdByDiscordRole) {
		bridgeRoleMappings.push({ discordRoleId, fluxerRoleId });
		await database.run(
			`INSERT INTO fluxer_role_mappings (discord_role_id, fluxer_role_id, updated_at_ms)
			 VALUES (?, ?, ?)
			 ON CONFLICT(discord_role_id) DO UPDATE SET
				fluxer_role_id = excluded.fluxer_role_id,
				updated_at_ms = excluded.updated_at_ms`,
			discordRoleId,
			fluxerRoleId,
			updatedAt
		);
	}
	await database.exec("COMMIT");
} catch (error) {
	await database.exec("ROLLBACK");
	throw error;
} finally {
	await database.close();
}
await writeFile(
	resolve(root, "app/services/fluxer/mappings.json"),
	JSON.stringify({ channels: bridgeChannelMappings, roles: bridgeRoleMappings }, null, "\t") +
		"\n"
);
step(`persisted ${catOrder.length + orderedChannels.length} channel and role mappings`);

// ---------------------------------------------------------------- summary
phase("Summary");
const finalRoles = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/roles`);
const finalChannels = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/channels`);
log(`Fluxer roles: ${finalRoles.length}`);
log(`Fluxer channels: ${finalChannels.length}`);
log("Roles: " + finalRoles.map(r => r.name).join(", "));
log("Channels: " + finalChannels.map(c => c.name).join(", "));
log("Done.");
