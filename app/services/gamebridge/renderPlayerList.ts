import { Resvg } from "@resvg/resvg-js";
import { GlobalFonts, createCanvas, loadImage } from "@napi-rs/canvas";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { Player } from "./GameConnection.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const FONT_PATH = path.join(process.cwd(), "resources/fonts/NotoSans-Regular.ttf");
const FONT_FAMILY = "PlayerListFont";
GlobalFonts.registerFromPath(FONT_PATH, FONT_FAMILY);

const RENDER_SCALE = 2;
const PADDING = 8;
const TEXT_RIGHT_PAD = 4;
const COL_GAP = 16;
const JOINING = " (joining)";
const JOINING_LABEL = "(joining)";
const JOINING_LABEL_GAP = 4;

const ROW_HEIGHT = 32;
const AVATAR_SIZE = 24;
const NAME_FONT_SIZE = 14;
const GAP = 6;

const ROW_HEIGHT_WITH_DESC = 56;
const AVATAR_SIZE_WITH_DESC = 44;
const NAME_FONT_SIZE_WITH_DESC = 16;
const DESC_FONT_SIZE = 12;
const GAP_WITH_DESC = 10;
const MIME_MAP: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

// Keyed by URL, not player - a player's headshot/avatar is refetched here on
// every poll otherwise, which is enough sustained hotlinking traffic to trip
// rate limits on the image hosts (catbox, imgbox, gyazo, ...). A changed URL
// is naturally a cache miss, so this never needs an expiry.
const dataUriCache = new Map<string, string>();

// resvg only decodes PNG/JPEG raster images embedded in <image> - other
// formats (e.g. WebP) get re-encoded to PNG first.
const RESVG_SUPPORTED_MIME = new Set(["image/png", "image/jpeg"]);

export async function toRenderableImage(
	buf: Buffer,
	mime: string
): Promise<{ buf: Buffer; mime: string }> {
	if (RESVG_SUPPORTED_MIME.has(mime)) return { buf, mime };
	try {
		const img = await loadImage(buf);
		const canvas = createCanvas(img.width, img.height);
		canvas.getContext("2d").drawImage(img, 0, 0);
		return { buf: await canvas.encode("png"), mime: "image/png" };
	} catch (err) {
		log.warn(err, `failed to convert ${mime} image for rendering`);
		return { buf, mime };
	}
}

const textWidthCache = new Map<string, number>();
const measureCtx = createCanvas(1, 1).getContext("2d");

function measureTextWidth(text: string, fontSize: number): number {
	const key = `${fontSize}:${text}`;
	const cached = textWidthCache.get(key);
	if (cached !== undefined) return cached;

	measureCtx.font = `${fontSize}px "${FONT_FAMILY}"`;
	const width = measureCtx.measureText(text).width;
	textWidthCache.set(key, width);
	return width;
}

const DATA_URI_RE = /^data:([^;]+);base64,(.+)$/s;

async function toDataUri(src?: string): Promise<string | undefined> {
	if (!src) return;

	const cached = dataUriCache.get(src);
	if (cached) return cached;

	let buf: Buffer;
	let mime: string;
	if (src.startsWith("data:")) {
		const match = DATA_URI_RE.exec(src);
		if (!match) return src; // not base64 - nothing to decode/convert
		mime = match[1];
		buf = Buffer.from(match[2], "base64");
	} else if (src.startsWith("http")) {
		const ext = src.includes(".") ? (src.split(".").pop() ?? "png") : "png";
		const extMime = MIME_MAP[ext] ?? "image/png";

		let res: Response;
		try {
			res = await fetch(src, {
				headers: {
					"User-Agent":
						"Mozilla/5.0 (compatible; node-metaconcord/1.0; +https://metastruct.net)",
					Accept: "image/*",
				},
			});
		} catch (err) {
			log.warn(err, `failed to fetch avatar/image from ${src}`);
			return;
		}
		if (!res.ok) {
			log.warn(`failed to fetch avatar/image from ${src}: HTTP ${res.status}`);
			return;
		}
		buf = Buffer.from(await res.arrayBuffer());
		mime = res.headers.get("content-type")?.split(";")[0] || extMime;
	} else {
		const ext = src.includes(".") ? (src.split(".").pop() ?? "png") : "png";
		buf = Buffer.from(await readFile(src));
		mime = MIME_MAP[ext] ?? "image/png";
	}

	const rendered = await toRenderableImage(buf, mime);
	const dataUri = `data:${rendered.mime};base64,${rendered.buf.toString("base64")}`;
	dataUriCache.set(src, dataUri);
	return dataUri;
}

export async function renderPlayerListImage(
	players: Player[],
	mapThumbnailSrc?: string
): Promise<Buffer> {
	const [mapThumbnailDataUri, ...avatarDataUris] = await Promise.all([
		toDataUri(mapThumbnailSrc),
		...players.map(async p => {
			if (!p.avatar) return;
			return await toDataUri(p.avatar).catch(() => {});
		}),
	]);

	const hasDescriptions = players.some(p => p.description);
	const rowHeight = hasDescriptions ? ROW_HEIGHT_WITH_DESC : ROW_HEIGHT;
	const avatarSize = hasDescriptions ? AVATAR_SIZE_WITH_DESC : AVATAR_SIZE;
	const nameFontSize = hasDescriptions ? NAME_FONT_SIZE_WITH_DESC : NAME_FONT_SIZE;
	const gap = hasDescriptions ? GAP_WITH_DESC : GAP;

	const cols = Math.max(1, Math.min(2, players.length));

	// The width of just the text block (nick + description, whichever is
	// wider) - used both for column sizing and to center the two lines on
	// each other below.
	const textWidths = players.map(p => {
		const isJoining = p.nick.endsWith(JOINING);
		const nick = isJoining ? p.nick.slice(0, -JOINING.length) : p.nick;
		let nameWidth = measureTextWidth(nick, nameFontSize);
		if (isJoining)
			nameWidth += JOINING_LABEL_GAP + measureTextWidth(JOINING_LABEL, nameFontSize);
		const descWidth = p.description ? measureTextWidth(p.description, DESC_FONT_SIZE) : 0;
		return Math.max(nameWidth, descWidth);
	});
	const requiredWidths = textWidths.map(w => avatarSize + gap + w + TEXT_RIGHT_PAD);

	// Each column is only as wide as its own longest entry, not the longest
	// entry across the whole list - otherwise one long name in one column
	// stretches out the other column's gap too.
	const colWidths = new Array(cols).fill(0);
	players.forEach((p, i) => {
		const col = i % cols;
		colWidths[col] = Math.max(colWidths[col], requiredWidths[i]);
	});
	const colOffsets = colWidths.map((_, col) =>
		colWidths.slice(0, col).reduce((sum, w) => sum + w + COL_GAP, 0)
	);

	const width =
		PADDING * 2 +
		(rowHeight - avatarSize) +
		colWidths.reduce((sum, w) => sum + w, 0) +
		(cols - 1) * COL_GAP;
	const rows = Math.max(1, Math.ceil(players.length / cols));
	const height = PADDING * 2 + rows * rowHeight;

	const items = players.map((p, i) => {
		const col = i % cols;
		const row = Math.floor(i / cols);
		const x = PADDING + (rowHeight - avatarSize) / 2 + colOffsets[col];
		const rowCenterY = PADDING + row * rowHeight + rowHeight / 2;

		const isJoining = p.nick.endsWith(JOINING);
		const nick = isJoining ? p.nick.slice(0, -JOINING.length) : p.nick;

		const color = p.isBanned ? "#FF0000" : p.isAdmin ? "#933f93" : "#2a77be";
		const opacity = p.isAfk ? 0.5 : 1;
		const avatarDataUri = avatarDataUris[i];
		const nickX = x + avatarSize + gap;

		const avatar = avatarDataUri
			? `<image href="${avatarDataUri}" x="${x}" y="${rowCenterY - avatarSize / 2}" width="${avatarSize}" height="${avatarSize}" clip-path="url(#clip)"/>`
			: `<circle cx="${x + avatarSize / 2}" cy="${rowCenterY}" r="${avatarSize / 2}" fill="#444" stroke="#555" stroke-width="1"/>`;

		const nameY = p.description ? rowCenterY - 4 : rowCenterY + nameFontSize * 0.35;
		const nameText = `<text x="${nickX}" y="${nameY}" fill="${color}" font-size="${nameFontSize}" font-family="${FONT_FAMILY}">${escapeXml(nick)}${isJoining ? `<tspan fill="#4ade80" font-style="italic" dx="${JOINING_LABEL_GAP}">${escapeXml(JOINING_LABEL)}</tspan>` : ""}</text>`;

		const descText = p.description
			? `<text x="${nickX}" y="${rowCenterY + DESC_FONT_SIZE + 2}" fill="white" font-size="${DESC_FONT_SIZE}" font-family="${FONT_FAMILY}">${escapeXml(p.description)}</text>`
			: "";

		return `<g opacity="${opacity}">
			${avatar}
			${nameText}
			${descText}
		</g>`;
	});

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<defs>
		<clipPath id="clip" clipPathUnits="objectBoundingBox">
			<circle cx="0.5" cy="0.5" r="0.5"/>
		</clipPath>
	</defs>
	<rect width="${width}" height="${height}" fill="#222"/>
	${mapThumbnailDataUri ? `<image href="${mapThumbnailDataUri}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>` : ""}
	<rect width="${width}" height="${height}" fill="rgba(0,0,0,0.85)"/>
	${items.join("\n")}
</svg>`;

	return new Resvg(svg, {
		fitTo: { mode: "zoom", value: RENDER_SCALE },
		font: {
			loadSystemFonts: false,
			fontFiles: [FONT_PATH],
			defaultFontFamily: FONT_FAMILY,
			sansSerifFamily: FONT_FAMILY,
		},
	})
		.render()
		.asPng();
}
