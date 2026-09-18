#!/usr/bin/env node
// One-off mirror: copy the Discord guild's custom emojis and stickers into the Fluxer guild.
// Reads config/discord.json (Discord side) + config/fluxer.json (Fluxer side).
// Usage: node scripts/mirror-expressions.mjs [--dry-run] [--yes] [--prune]
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { open } from "sqlite";
import sqlite3 from "sqlite3";

const root = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const assumeYes = args.has("--yes");
const prune = args.has("--prune");

const discordConfig = JSON.parse(await readFile(resolve(root, "config/discord.json"), "utf8"));
const fluxerConfig = JSON.parse(await readFile(resolve(root, "config/fluxer.json"), "utf8"));

const DISCORD_API = "https://discord.com/api/v10";
const FLUXER_API = fluxerConfig.apiBaseUrl;
const DISCORD_GUILD = discordConfig.bot.primaryGuildId;
const FLUXER_GUILD = fluxerConfig.guildId;

// Fluxer create rate limits from the documentation, with a safety margin.
const BULK_CREATE_INTERVAL_MS = 12_000; // 6 per minute
const ITEM_CREATE_INTERVAL_MS = 4_000; // 10 per 30 seconds
const BULK_CHUNK_SIZE = 50;
const MAX_EXPRESSION_BYTES = 524_288; // resolved emoji_max_size / sticker_max_size default

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

async function downloadImage(url) {
	let res;
	try {
		res = await fetch(url, { signal: AbortSignal.timeout(60_000) });
	} catch (error) {
		warn(`image download failed: ${url} (${error.message})`);
		return null;
	}
	if (!res.ok) {
		warn(`image download failed: ${url} (HTTP ${res.status})`);
		return null;
	}
	const bytes = Buffer.from(await res.arrayBuffer());
	if (bytes.length === 0 || bytes.length > MAX_EXPRESSION_BYTES) {
		warn(`image ${url} is ${bytes.length} bytes; skipping (limit ${MAX_EXPRESSION_BYTES})`);
		return null;
	}
	return bytes.toString("base64");
}

// ---------------------------------------------------------------- fetch source
phase("Fetching Discord source data");
const [discordEmojis, discordStickers] = await Promise.all([
	discordApi(`/guilds/${DISCORD_GUILD}/emojis`),
	discordApi(`/guilds/${DISCORD_GUILD}/stickers`),
]);

// ---------------------------------------------------------------- fetch Fluxer state
phase("Fetching Fluxer current state");
const [fluxerEmojis, fluxerStickers] = await Promise.all([
	fluxerApi("GET", `/guilds/${FLUXER_GUILD}/emojis`),
	fluxerApi("GET", `/guilds/${FLUXER_GUILD}/stickers`),
]);
const fluxerEmojiByName = new Map(fluxerEmojis.map(emoji => [emoji.name, emoji]));
const fluxerStickerByName = new Map(fluxerStickers.map(sticker => [sticker.name, sticker]));

// ---------------------------------------------------------------- plan
phase("Plan");
let planEmojiCreate = 0;
let planEmojiReuse = 0;
for (const emoji of discordEmojis) {
	if (fluxerEmojiByName.has(emoji.name)) {
		planEmojiReuse++;
		log(`  [emoji] reuse "${emoji.name}" (${fluxerEmojiByName.get(emoji.name).id})`);
	} else {
		planEmojiCreate++;
		log(`  [emoji] create "${emoji.name}" (${emoji.animated ? "animated" : "static"})`);
	}
}
let planStickerCreate = 0;
let planStickerReuse = 0;
let planStickerSkip = 0;
for (const sticker of discordStickers) {
	if (sticker.format_type === 3) {
		planStickerSkip++;
		log(`  [sticker] skip "${sticker.name}" (Lottie is not supported on Fluxer)`);
	} else if (fluxerStickerByName.has(sticker.name)) {
		planStickerReuse++;
		log(`  [sticker] reuse "${sticker.name}" (${fluxerStickerByName.get(sticker.name).id})`);
	} else {
		planStickerCreate++;
		log(`  [sticker] create "${sticker.name}"`);
	}
}
if (planStickerSkip > 0) {
	warn(
		`${planStickerSkip} Lottie sticker${planStickerSkip === 1 ? "" : "s"} cannot be copied as an image; skipping.`
	);
}

if (dryRun) {
	log("\nDRY RUN - no changes made.");
	process.exit(0);
}
if (!assumeYes) {
	const { createInterface } = await import("node:readline/promises");
	const rl = createInterface({ input: process.stdin, output: process.stdout });
	const answer = await rl.question(`\nApply this mirror to "${FLUXER_GUILD}"? (y/N) `);
	rl.close();
	if (!/^y/i.test(answer)) {
		log("Aborted.");
		process.exit(1);
	}
}

// ---------------------------------------------------------------- bulk create helper
// Items may carry a `_source` field for mapping results back; it is stripped before sending.
async function bulkCreate(collection, items, basePath) {
	const chunks = [];
	for (let i = 0; i < items.length; i += BULK_CHUNK_SIZE) {
		chunks.push(items.slice(i, i + BULK_CHUNK_SIZE));
	}
	const results = [];
	for (let i = 0; i < chunks.length; i++) {
		if (i > 0) await sleep(BULK_CREATE_INTERVAL_MS);
		const body = { [collection]: chunks[i].map(({ _source, ...item }) => item) };
		try {
			const response = await fluxerApi("POST", `${basePath}/bulk`, body);
			results.push(...(response.success ?? []));
			for (const failed of response.failed ?? []) {
				warn(`failed to create ${failed.name}: ${failed.error}`);
			}
		} catch (error) {
			warn(`bulk create failed (${error.message}); falling back per item`);
			for (const item of chunks[i]) {
				try {
					const { _source, ...body } = item;
					const created = await fluxerApi("POST", basePath, body);
					results.push(created);
				} catch (itemError) {
					warn(`failed to create ${item.name}: ${itemError.message}`);
				}
				await sleep(ITEM_CREATE_INTERVAL_MS);
			}
		}
	}
	return results;
}

// ---------------------------------------------------------------- emojis
phase("Mirroring emojis");
const emojiMappings = [];
const emojisToCreate = [];
for (const emoji of discordEmojis) {
	if (fluxerEmojiByName.has(emoji.name)) {
		const fluxerEmoji = fluxerEmojiByName.get(emoji.name);
		emojiMappings.push({
			discordEmojiId: emoji.id,
			fluxerEmojiId: fluxerEmoji.id,
			name: emoji.name,
			animated: emoji.animated === true,
		});
		step(`reusing emoji "${emoji.name}" (${fluxerEmoji.id})`);
		continue;
	}
	const image = await downloadImage(
		`https://cdn.discordapp.com/emojis/${emoji.id}.${emoji.animated ? "gif" : "png"}`
	);
	if (!image) continue;
	emojisToCreate.push({ name: emoji.name, image, _source: emoji });
}
if (emojisToCreate.length > 0) {
	const created = await bulkCreate("emojis", emojisToCreate, `/guilds/${FLUXER_GUILD}/emojis`);
	const byName = new Map(created.map(emoji => [emoji.name, emoji]));
	for (const item of emojisToCreate) {
		const target = byName.get(item._source.name);
		if (!target) {
			warn(`no created Fluxer emoji for "${item._source.name}"`);
			continue;
		}
		emojiMappings.push({
			discordEmojiId: item._source.id,
			fluxerEmojiId: target.id,
			name: item._source.name,
			animated: item._source.animated === true,
		});
		step(`created emoji "${item._source.name}" (${target.id})`);
	}
}

// ---------------------------------------------------------------- stickers
phase("Mirroring stickers");
const stickerMappings = [];
const stickersToCreate = [];
for (const sticker of discordStickers) {
	if (sticker.format_type === 3) {
		warn(`skipping Lottie sticker "${sticker.name}" (not supported on Fluxer)`);
		continue;
	}
	if (fluxerStickerByName.has(sticker.name)) {
		const fluxerSticker = fluxerStickerByName.get(sticker.name);
		stickerMappings.push({
			discordStickerId: sticker.id,
			fluxerStickerId: fluxerSticker.id,
			name: sticker.name,
		});
		step(`reusing sticker "${sticker.name}" (${fluxerSticker.id})`);
		continue;
	}
	const extension = sticker.format_type === 4 ? "gif" : "png";
	const image = await downloadImage(
		`https://media.discordapp.net/stickers/${sticker.id}.${extension}`
	);
	if (!image) continue;
	stickersToCreate.push({
		name: sticker.name,
		...(sticker.description ? { description: sticker.description } : {}),
		...(typeof sticker.tags === "string" && sticker.tags.length > 0
			? {
					tags: sticker.tags
						.split(",")
						.map(tag => tag.trim())
						.filter(Boolean)
						.slice(0, 10),
				}
			: {}),
		image,
		_source: sticker,
	});
}
if (stickersToCreate.length > 0) {
	const created = await bulkCreate(
		"stickers",
		stickersToCreate,
		`/guilds/${FLUXER_GUILD}/stickers`
	);
	const byName = new Map(created.map(sticker => [sticker.name, sticker]));
	for (const item of stickersToCreate) {
		const target = byName.get(item._source.name);
		if (!target) {
			warn(`no created Fluxer sticker for "${item._source.name}"`);
			continue;
		}
		stickerMappings.push({
			discordStickerId: item._source.id,
			fluxerStickerId: target.id,
			name: item._source.name,
		});
		step(`created sticker "${item._source.name}" (${target.id})`);
	}
}

// ---------------------------------------------------------------- prune optional
if (prune) {
	phase("Pruning orphaned Fluxer expressions");
	for (const emoji of fluxerEmojis) {
		if (discordEmojis.some(source => source.name === emoji.name)) continue;
		await fluxerApi("DELETE", `/guilds/${FLUXER_GUILD}/emojis/${emoji.id}`);
		await sleep(ITEM_CREATE_INTERVAL_MS);
		step(`pruned emoji "${emoji.name}" (${emoji.id})`);
	}
	for (const sticker of fluxerStickers) {
		if (discordStickers.some(source => source.name === sticker.name)) continue;
		await fluxerApi("DELETE", `/guilds/${FLUXER_GUILD}/stickers/${sticker.id}`);
		await sleep(ITEM_CREATE_INTERVAL_MS);
		step(`pruned sticker "${sticker.name}" (${sticker.id})`);
	}
}

// ---------------------------------------------------------------- persist mappings
phase("Persisting bridge mappings");
const emojiMappingsByFluxer = new Map(
	emojiMappings.map(mapping => [mapping.fluxerEmojiId, mapping])
);
for (const dropped of emojiMappings.filter(
	mapping => emojiMappingsByFluxer.get(mapping.fluxerEmojiId) !== mapping
)) {
	warn(
		`dropping duplicate mapping for Fluxer emoji "${dropped.name}" (${dropped.fluxerEmojiId})`
	);
}
const stickerMappingsByFluxer = new Map(
	stickerMappings.map(mapping => [mapping.fluxerStickerId, mapping])
);
for (const dropped of stickerMappings.filter(
	mapping => stickerMappingsByFluxer.get(mapping.fluxerStickerId) !== mapping
)) {
	warn(
		`dropping duplicate mapping for Fluxer sticker "${dropped.name}" (${dropped.fluxerStickerId})`
	);
}
const database = await open({
	driver: sqlite3.Database,
	filename: process.env.METACONCORD_DB_PATH ?? resolve(root, "metaconcord.db"),
});
await database.exec(`
	CREATE TABLE IF NOT EXISTS fluxer_emoji_mappings (
		discord_emoji_id TEXT PRIMARY KEY,
		fluxer_emoji_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		animated INTEGER NOT NULL CHECK (animated IN (0, 1)),
		updated_at_ms INTEGER NOT NULL
	);
	CREATE TABLE IF NOT EXISTS fluxer_sticker_mappings (
		discord_sticker_id TEXT PRIMARY KEY,
		fluxer_sticker_id TEXT NOT NULL UNIQUE,
		name TEXT NOT NULL,
		updated_at_ms INTEGER NOT NULL
	);
`);
await database.exec("BEGIN IMMEDIATE");
try {
	const updatedAt = Date.now();
	await database.run("DELETE FROM fluxer_emoji_mappings");
	for (const mapping of emojiMappingsByFluxer.values()) {
		await database.run(
			`INSERT INTO fluxer_emoji_mappings
				(discord_emoji_id, fluxer_emoji_id, name, animated, updated_at_ms)
			 VALUES (?, ?, ?, ?, ?)`,
			mapping.discordEmojiId,
			mapping.fluxerEmojiId,
			mapping.name,
			mapping.animated ? 1 : 0,
			updatedAt
		);
	}
	await database.run("DELETE FROM fluxer_sticker_mappings");
	for (const mapping of stickerMappingsByFluxer.values()) {
		await database.run(
			`INSERT INTO fluxer_sticker_mappings
				(discord_sticker_id, fluxer_sticker_id, name, updated_at_ms)
			 VALUES (?, ?, ?, ?)`,
			mapping.discordStickerId,
			mapping.fluxerStickerId,
			mapping.name,
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
step(
	`persisted ${emojiMappingsByFluxer.size} emoji and ${stickerMappingsByFluxer.size} sticker mappings`
);

// ---------------------------------------------------------------- summary
phase("Summary");
log(
	`Emojis: ${discordEmojis.length} on Discord, ${planEmojiReuse} reused, ${planEmojiCreate} to create (${emojiMappingsByFluxer.size} mapped)`
);
log(
	`Stickers: ${discordStickers.length} on Discord, ${planStickerReuse} reused, ${planStickerCreate} to create (${stickerMappingsByFluxer.size} mapped), ${planStickerSkip} skipped`
);
log("Done.");
