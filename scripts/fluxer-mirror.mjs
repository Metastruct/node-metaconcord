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
const [discordRoles, discordChannels, discordActiveThreads] = await Promise.all([
	discordApi(`/guilds/${DISCORD_GUILD}/roles`),
	discordApi(`/guilds/${DISCORD_GUILD}/channels`),
	discordApi(`/guilds/${DISCORD_GUILD}/threads/active`).catch(error => {
		warn(`could not fetch active threads: ${error.message}`);
		return { threads: [] };
	}),
]);
const roleById = new Map(discordRoles.map(r => [r.id, r]));
const channelById = new Map(discordChannels.map(c => [c.id, c]));
const addDiscordThread = thread => {
	if (!thread?.id || channelById.has(thread.id)) return;
	channelById.set(thread.id, thread);
};
for (const thread of discordActiveThreads.threads ?? []) addDiscordThread(thread);
for (const threadId of Object.values(discordConfig.threads)) {
	if (channelById.has(threadId)) continue;
	const thread = await discordApi(`/channels/${threadId}`);
	addDiscordThread(thread);
}

// ---------------------------------------------------------------- build plan
const FLUXER_CHANNEL_TYPE = {
	0: 0, // GUILD_TEXT
	2: 2, // GUILD_VOICE
	4: 4, // GUILD_CATEGORY
	5: 0, // GUILD_ANNOUNCEMENT -> text
	13: 2, // GUILD_STAGE_VOICE -> voice
	15: 15, // GUILD_FORUM
	16: 16, // GUILD_MEDIA
};
const DISCORD_THREAD_TYPES = new Set([10, 11, 12]);
const FORUM_PARENT_TYPES = new Set([15, 16]);

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
const desiredThreads = new Map();
const addChannel = (discordId, configName) => {
	if (!channelById.has(discordId)) {
		warn(`channel ${configName} (${discordId}) missing from Discord`);
		return;
	}
	const src = channelById.get(discordId);
	if (DISCORD_THREAD_TYPES.has(src.type)) {
		if (!src.parent_id) {
			warn(`thread ${configName} (${discordId}) has no parent, skipping`);
			return;
		}
		desiredThreads.set(discordId, { configName, src, parentDiscordId: src.parent_id });
		return;
	}
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
// Pick up channels newly added to categories we already mirror (e.g. "projects").
for (const src of discordChannels) {
	if (src.type === 4 || desiredChannels.has(src.id) || desiredThreads.has(src.id)) continue;
	if (src.parent_id && desiredCategories.has(src.parent_id)) {
		addChannel(src.id, `category-new:${src.name}`);
	}
}
// Every active (or explicitly configured) thread whose parent we mirror.
for (const src of channelById.values()) {
	if (!DISCORD_THREAD_TYPES.has(src.type) || desiredThreads.has(src.id)) continue;
	if (!src.parent_id) continue;
	desiredThreads.set(src.id, {
		configName: `thread:${src.name}`,
		src,
		parentDiscordId: src.parent_id,
	});
}
const isArchivedThread = src =>
	src.thread_metadata?.archived === true || src.thread_metadata?.locked === true;
const desiredThreadList = [...desiredThreads.values()].filter(thread =>
	desiredChannels.has(thread.parentDiscordId)
);

const channelPosition = ch => {
	if (!DISCORD_THREAD_TYPES.has(ch.src.type)) return ch.src.position ?? 0;
	const threadParent = ch.src.parent_id ? channelById.get(ch.src.parent_id) : null;
	return (threadParent?.position ?? 0) + 0.5;
};
const isTextLike = type => type === 0 || type === 5 || type === 15 || type === 16;
const compareChannels = (a, b) => {
	// Fluxer groups text-like channels before voice channels within each category.
	const aText = isTextLike(a.type) ? 0 : 1;
	const bText = isTextLike(b.type) ? 0 : 1;
	if (aText !== bText) return aText - bText;
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
const botAdminRoles = fluxerRoles.filter(
	r => fluxerMember.roles.includes(r.id) && (BigInt(r.permissions) & (1n << 3n)) !== 0n
);
const stockAdministrator =
	botAdminRoles.find(r => r.name === administratorRole?.name) ?? botAdminRoles[0];
if (!administratorRole || !stockAdministrator) {
	throw new Error("Could not identify the bot's existing Fluxer Administrator role");
}
const fluxerRoleByName = new Map(
	fluxerRoles
		.filter(r => r.id !== FLUXER_EVERYONE && r.id !== stockAdministrator.id)
		.map(r => [r.name, r])
);

// Prior bridge mappings let reruns reuse created threads and retire legacy stand-ins.
const priorMappingsPath = resolve(root, "app/services/fluxer/mappings.json");
let priorMappings = { channels: [], threads: [], roles: [] };
try {
	priorMappings = JSON.parse(await readFile(priorMappingsPath, "utf8"));
} catch {
	warn("no prior mappings.json found; treating this as a first run");
}
const priorChannelByDiscord = new Map(
	(priorMappings.channels ?? []).map(channel => [channel.discordChannelId, channel])
);
const priorThreadByDiscord = new Map(
	(priorMappings.threads ?? []).map(thread => [thread.discordThreadId, thread])
);
// Merge runtime-created thread links from the bridge database so reruns reuse them.
const databasePath = process.env.METACONCORD_DB_PATH ?? resolve(root, "metaconcord.db");
try {
	const existingDb = await open({ driver: sqlite3.Database, filename: databasePath });
	const rows = await existingDb.all("SELECT * FROM fluxer_thread_links").catch(() => []);
	await existingDb.close();
	for (const row of rows) {
		if (priorThreadByDiscord.has(row.discord_thread_id)) continue;
		priorThreadByDiscord.set(row.discord_thread_id, {
			discordThreadId: row.discord_thread_id,
			fluxerThreadId: row.fluxer_thread_id,
			discordParentId: row.discord_parent_id,
			fluxerParentId: row.fluxer_parent_id,
			channelKind: row.channel_kind,
			relayEnabled: row.relay_enabled === 1,
		});
	}
} catch {
	warn("could not read runtime thread links from the bridge database");
}

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
log(`Threads to mirror (${desiredThreadList.length}):`);
for (const thread of desiredThreadList) {
	const parent = desiredChannels.get(thread.parentDiscordId);
	const kind = FORUM_PARENT_TYPES.has(parent?.src.type)
		? isArchivedThread(thread.src)
			? "archived forum post"
			: "forum post"
		: isArchivedThread(thread.src)
			? "archived thread"
			: "thread";
	log(
		`  - ${thread.configName}: "${thread.src.name}" (${kind}, parent "${parent?.src.name ?? thread.parentDiscordId}")`
	);
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
// Existing fluxer channels keyed by type+name for idempotent re-runs.
const fluxerCategoryByName = new Map(
	fluxerChannels.filter(c => c.type === 4).map(c => [c.name, c])
);
const fluxerChannelByTypeName = new Map(
	fluxerChannels.filter(c => c.type !== 4).map(c => [`${c.type}:${c.name}`, c])
);
// Discord tag id -> Fluxer tag id, resolved by name against the mirrored forum.
const fluxerTagIdByDiscordTagId = new Map();
const registerForumTags = (discordChannel, fluxerChannel) => {
	for (const tag of discordChannel.available_tags ?? []) {
		const match = (fluxerChannel.available_tags ?? []).find(
			candidate => candidate.name === tag.name
		);
		if (match) fluxerTagIdByDiscordTagId.set(tag.id, match.id);
	}
};

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

const forumFieldsFor = src => {
	if (!FORUM_PARENT_TYPES.has(src.type)) return {};
	// Discord custom-emoji ids are not valid Fluxer ids, so only unicode emoji are mirrored.
	const tags = (src.available_tags ?? []).slice(0, 20).map(tag => ({
		name: tag.name,
		moderated: tag.moderated === true,
		...(tag.emoji_name ? { emoji_name: tag.emoji_name } : {}),
	}));
	const defaultReactionName = src.default_reaction_emoji?.emoji_name;
	const forumFlagMask = (1 << 4) | (1 << 15); // REQUIRE_TAG | HIDE_MEDIA_DOWNLOAD_OPTIONS
	const flags = (src.flags ?? 0) & forumFlagMask;
	return {
		...(src.default_auto_archive_duration != null
			? { default_auto_archive_duration: src.default_auto_archive_duration }
			: {}),
		...(src.default_thread_rate_limit_per_user != null
			? {
					default_thread_rate_limit_per_user: src.default_thread_rate_limit_per_user,
				}
			: {}),
		...(tags.length > 0 ? { available_tags: tags } : {}),
		...(defaultReactionName
			? { default_reaction_emoji: { emoji_name: defaultReactionName } }
			: {}),
		...(src.default_sort_order != null ? { default_sort_order: src.default_sort_order } : {}),
		...(src.default_forum_layout != null
			? { default_forum_layout: src.default_forum_layout }
			: {}),
		...(flags !== 0 ? { flags } : {}),
	};
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
		...forumFieldsFor(src),
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
	const existing = fluxerChannelByTypeName.get(`${ch.type}:${ch.src.name}`);
	if (existing && (existing.parent_id ?? null) === (categoryFluxerId ?? null)) {
		fluxerIdByDiscordChannel.set(ch.src.id, existing.id);
		registerForumTags(ch.src, existing);
		step(`reusing existing channel "${ch.src.name}" (${existing.id})`);
		continue;
	}
	const created = await fluxerApi("POST", `/guilds/${FLUXER_GUILD}/channels`, body);
	await sleep(6200);
	fluxerIdByDiscordChannel.set(ch.src.id, created.id);
	registerForumTags(ch.src, created);
	step(`created channel "${ch.src.name}" (${created.id})`);
}

phase("Mirroring threads and forum posts");
const fluxerIdByDiscordThread = new Map();
const bridgeThreadMappings = [];
const fetchFluxerChannel = async id => {
	try {
		return await fluxerApi("GET", `/channels/${id}`);
	} catch {
		return null;
	}
};
const starterMessageFor = async thread => {
	if (!FORUM_PARENT_TYPES.has(channelById.get(thread.parentDiscordId)?.type)) return null;
	try {
		return await discordApi(`/channels/${thread.src.id}/messages/${thread.src.id}`);
	} catch {
		return null;
	}
};
const threadLinkFor = (thread, fluxerThreadId, channelKind) => ({
	discordThreadId: thread.src.id,
	fluxerThreadId,
	discordParentId: thread.parentDiscordId,
	fluxerParentId: fluxerIdByDiscordChannel.get(thread.parentDiscordId),
	channelKind,
	relayEnabled: true,
});
for (const thread of desiredThreadList) {
	const parent = desiredChannels.get(thread.parentDiscordId);
	const parentFluxerId = fluxerIdByDiscordChannel.get(thread.parentDiscordId);
	const isForumPost = FORUM_PARENT_TYPES.has(parent?.src.type);
	const archived = isArchivedThread(thread.src);
	const channelKind = isForumPost ? "forum_post" : "thread";
	if (dryRun) {
		step(`[dry] would create ${channelKind} "${thread.src.name}" under "${parent.src.name}"`);
		continue;
	}
	const prior = priorThreadByDiscord.get(thread.src.id);
	let fluxerThread = prior ? await fetchFluxerChannel(prior.fluxerThreadId) : null;
	if (fluxerThread && (fluxerThread.parent_id ?? null) === parentFluxerId) {
		step(`reusing existing ${channelKind} "${thread.src.name}" (${fluxerThread.id})`);
	} else {
		fluxerThread = null;
	}
	if (!fluxerThread) {
		if (isForumPost) {
			const starter = await starterMessageFor(thread);
			const appliedTags = (thread.src.applied_tags ?? [])
				.map(id => fluxerTagIdByDiscordTagId.get(id))
				.filter(Boolean)
				.slice(0, 5);
			const body = {
				name: thread.src.name,
				message: {
					content:
						starter?.content?.trim() ||
						`[View this Discord post](<https://discord.com/channels/${DISCORD_GUILD}/${thread.src.id}>)`,
				},
				...(appliedTags.length > 0 ? { applied_tags: appliedTags } : {}),
			};
			fluxerThread = await fluxerApi("POST", `/channels/${parentFluxerId}/threads`, body);
			await sleep(6200); // channel:thread:create is 10/min
			step(`created forum post "${thread.src.name}" (${fluxerThread.id})`);
		} else {
			const body = {
				name: thread.src.name,
				type: thread.src.type === 10 ? 11 : thread.src.type,
				...(thread.src.thread_metadata?.auto_archive_duration != null
					? {
							auto_archive_duration: thread.src.thread_metadata.auto_archive_duration,
						}
					: {}),
				...(thread.src.rate_limit_per_user != null
					? { rate_limit_per_user: thread.src.rate_limit_per_user }
					: {}),
				...(thread.src.type === 12 && thread.src.thread_metadata?.invitable != null
					? { invitable: thread.src.thread_metadata.invitable }
					: {}),
			};
			fluxerThread = await fluxerApi("POST", `/channels/${parentFluxerId}/threads`, body);
			await sleep(6200);
			step(`created thread "${thread.src.name}" (${fluxerThread.id})`);
		}
		if (archived) {
			await fluxerApi("PATCH", `/channels/${fluxerThread.id}`, {
				archived: true,
				...(thread.src.thread_metadata?.locked ? { locked: true } : {}),
			});
			step(`archived "${thread.src.name}"`);
		}
	}
	fluxerIdByDiscordThread.set(thread.src.id, fluxerThread.id);
	bridgeThreadMappings.push(threadLinkFor(thread, fluxerThread.id, channelKind));
}

phase("Reconciling channel topics and access");
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
const currentFluxerChannels = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/channels`);
const currentFluxerChannelById = new Map(
	currentFluxerChannels.map(channel => [channel.id, channel])
);
for (const ch of orderedChannels) {
	const fluxerId = fluxerIdByDiscordChannel.get(ch.src.id);
	const current = currentFluxerChannelById.get(fluxerId);
	const topic = translateTopic(ch.src.topic);
	if ((current?.topic ?? null) === topic) continue;
	await fluxerApi("PATCH", `/channels/${fluxerId}`, { topic });
	await sleep(600);
	step(`updated topic for "${ch.src.name}"`);
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

phase("Retiring legacy thread and forum stand-ins");
const legacyRetired = [];
for (const [discordId, prior] of priorChannelByDiscord) {
	if (!["thread", "archived_thread", "forum_placeholder"].includes(prior.channelKind)) continue;
	const replacedByThread = fluxerIdByDiscordThread.has(discordId);
	const replacedByForum = FORUM_PARENT_TYPES.has(desiredChannels.get(discordId)?.src.type);
	if (!replacedByThread && !replacedByForum) continue;
	if (!prior.fluxerChannelId) continue;
	const stale = await fetchFluxerChannel(prior.fluxerChannelId);
	if (!stale) continue;
	if (args.has("--delete-legacy")) {
		if (dryRun) step(`[dry] would delete legacy channel ${stale.id}`);
		else {
			await fluxerApi("DELETE", `/channels/${stale.id}`);
			await sleep(600);
			legacyRetired.push(stale.id);
			step(`deleted legacy channel "${stale.name}" (${stale.id})`);
		}
	} else if (!stale.name?.endsWith(" (legacy)")) {
		if (dryRun) step(`[dry] would retire legacy channel "${stale.name}" (${stale.id})`);
		else {
			await fluxerApi("PATCH", `/channels/${stale.id}`, {
				name: `${stale.name} (legacy)`,
			});
			await sleep(600);
			legacyRetired.push(stale.id);
			step(`retired legacy channel "${stale.name}" (${stale.id})`);
		}
	}
}

phase("Persisting bridge mappings");
const bridgeChannelMappings = [];
const bridgeRoleMappings = [];
const database = await open({
	driver: sqlite3.Database,
	filename: databasePath,
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
	CREATE TABLE IF NOT EXISTS fluxer_thread_links (
		discord_thread_id TEXT PRIMARY KEY,
		fluxer_thread_id TEXT NOT NULL UNIQUE,
		discord_parent_id TEXT NOT NULL,
		fluxer_parent_id TEXT NOT NULL,
		channel_kind TEXT NOT NULL,
		relay_enabled INTEGER NOT NULL DEFAULT 1 CHECK (relay_enabled IN (0, 1)),
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
		const channelKind = FORUM_PARENT_TYPES.has(ch.src.type)
			? "forum"
			: ch.type === 2
				? "voice"
				: "text";
		const relayEnabled = channelKind === "text" || channelKind === "forum" ? 1 : 0;
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
	await database.run("DELETE FROM fluxer_thread_links");
	for (const thread of bridgeThreadMappings) {
		await database.run(
			`INSERT INTO fluxer_thread_links
				(discord_thread_id, fluxer_thread_id, discord_parent_id, fluxer_parent_id, channel_kind, relay_enabled, updated_at_ms)
			 VALUES (?, ?, ?, ?, ?, ?, ?)
			 ON CONFLICT(discord_thread_id) DO UPDATE SET
				fluxer_thread_id = excluded.fluxer_thread_id,
				discord_parent_id = excluded.discord_parent_id,
				fluxer_parent_id = excluded.fluxer_parent_id,
				channel_kind = excluded.channel_kind,
				relay_enabled = excluded.relay_enabled,
				updated_at_ms = excluded.updated_at_ms`,
			thread.discordThreadId,
			thread.fluxerThreadId,
			thread.discordParentId,
			thread.fluxerParentId,
			thread.channelKind,
			thread.relayEnabled ? 1 : 0,
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
	JSON.stringify(
		{
			channels: bridgeChannelMappings,
			threads: bridgeThreadMappings,
			roles: bridgeRoleMappings,
			permanentMessageChannelIds: [
				discordConfig.channels.rules,
				discordConfig.channels.serverStatus,
			],
		},
		null,
		"\t"
	) + "\n"
);
step(
	`persisted ${catOrder.length + orderedChannels.length} channels, ` +
		`${bridgeThreadMappings.length} threads, ${bridgeRoleMappings.length} roles`
);
step(`retired ${legacyRetired.length} legacy stand-in channels`);

// ---------------------------------------------------------------- summary
phase("Summary");
const finalRoles = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/roles`);
const finalChannels = await fluxerApi("GET", `/guilds/${FLUXER_GUILD}/channels`);
log(`Fluxer roles: ${finalRoles.length}`);
log(`Fluxer channels: ${finalChannels.length}`);
log("Roles: " + finalRoles.map(r => r.name).join(", "));
log("Channels: " + finalChannels.map(c => c.name).join(", "));
log("Done.");
