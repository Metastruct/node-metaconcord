import { createCanvas, loadImage } from "@napi-rs/canvas";

import { logger } from "#utils";

const log = logger(import.meta);

// Minecraft skins are 64x64 (modern) or 64x32 (legacy); in both layouts the
// face is the 8x8 region at (8, 8). The hat/head overlay at (40, 8) only
// exists in the 64x64 format - in a 64x32 skin that area is unused and often
// filled solid black, so painting it would cover the face.
const FACE = { x: 8, y: 8, width: 8, height: 8 };
const HAT = { x: 40, y: 8, width: 8, height: 8 };
const OUTPUT_SIZE = 128; // maybe overkill, but who knows

const UUID_RE = /^[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}$/i;
const TEXTURES_PROPERTY = "textures";

const headCache = new Map<string, string>();

const FAILED_RENDER_RETRY_MS = 10 * 60 * 1000;
const failedRenderCache = new Map<string, number>();

const undash = (uuid: string): string => uuid.replaceAll("-", "").toLowerCase();

async function resolveUuid(identifier: string): Promise<string | undefined> {
	if (UUID_RE.test(identifier)) return undash(identifier);

	// mc-heads accepts usernames too, so keep that working where possible.
	const res = await fetch(
		`https://api.mojang.com/users/profiles/minecraft/${encodeURIComponent(identifier)}`
	);
	if (!res.ok) return;
	const body = (await res.json()) as { id?: string };
	return body.id ? undash(body.id) : undefined;
}

async function fetchSkinUrl(uuid: string): Promise<string | undefined> {
	const res = await fetch(
		`https://sessionserver.mojang.com/session/minecraft/profile/${uuid}`
	);
	if (!res.ok) return;

	const body = (await res.json()) as {
		properties?: { name: string; value: string }[];
	};
	const encoded = body.properties?.find(p => p.name === TEXTURES_PROPERTY)?.value;
	if (!encoded) return;

	const decoded = JSON.parse(Buffer.from(encoded, "base64").toString("utf8")) as {
		textures?: { SKIN?: { url?: string } };
	};
	return decoded.textures?.SKIN?.url;
}

/**
 * Resolves a UUID (or username) to a locally rendered head as a PNG data URI,
 * or undefined if the skin couldn't be found/fetched.
 */
export async function renderHeadDataUri(identifier: string): Promise<string | undefined> {
	const cached = headCache.get(identifier);
	if (cached) return cached;

	const failedAt = failedRenderCache.get(identifier);
	if (failedAt !== undefined && Date.now() - failedAt < FAILED_RENDER_RETRY_MS) return;

	try {
		const uuid = await resolveUuid(identifier);
		if (!uuid) {
			failedRenderCache.set(identifier, Date.now());
			return;
		}

		const skinUrl = await fetchSkinUrl(uuid);
		if (!skinUrl) {
			failedRenderCache.set(identifier, Date.now());
			return;
		}

		const skinRes = await fetch(skinUrl);
		if (!skinRes.ok) {
			failedRenderCache.set(identifier, Date.now());
			return;
		}
		const skin = await loadImage(Buffer.from(await skinRes.arrayBuffer()));

		const canvas = createCanvas(OUTPUT_SIZE, OUTPUT_SIZE);
		const ctx = canvas.getContext("2d");
		ctx.imageSmoothingEnabled = false;
		ctx.drawImage(skin, FACE.x, FACE.y, FACE.width, FACE.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);
		if (skin.height >= 64)
			ctx.drawImage(skin, HAT.x, HAT.y, HAT.width, HAT.height, 0, 0, OUTPUT_SIZE, OUTPUT_SIZE);

		const dataUri = `data:image/png;base64,${(await canvas.encode("png")).toString("base64")}`;
		headCache.set(identifier, dataUri);
		failedRenderCache.delete(identifier);
		return dataUri;
	} catch (error) {
		log.warn(error, `failed to render head for ${identifier}`);
		failedRenderCache.set(identifier, Date.now());
	}
}
