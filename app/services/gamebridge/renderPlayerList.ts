import { Resvg } from "@resvg/resvg-js";
import { readFile } from "node:fs/promises";
import { Player } from "./GameServer.js";

const escapeXml = (s: string) =>
	s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const ROW_HEIGHT = 32;
const PADDING = 8;
const MAX_WIDTH = 400;
const AVATAR_SIZE = 24;
const GAP = 6;
const JOINING = " (joining)";
const MIME_MAP: Record<string, string> = {
	png: "image/png",
	jpg: "image/jpeg",
	jpeg: "image/jpeg",
	webp: "image/webp",
	gif: "image/gif",
};

async function toDataUri(src: string): Promise<string> {
	if (src.startsWith("data:")) return src;
	const buf = src.startsWith("http")
		? new Uint8Array(await (await fetch(src)).arrayBuffer())
		: await readFile(src);
	const ext = src.includes(".") ? (src.split(".").pop() ?? "png") : "png";
	return `data:${MIME_MAP[ext] ?? "image/png"};base64,${Buffer.from(buf).toString("base64")}`;
}

export async function renderPlayerListImage(
	players: Player[],
	mapThumbnailSrc: string
): Promise<Buffer> {
	const [mapThumbnailDataUri, ...avatarDataUris] = await Promise.all([
		toDataUri(mapThumbnailSrc),
		...players.map(async p => {
			if (!p.avatar) return;
			try {
				return await toDataUri(p.avatar);
			} catch {}
		}),
	]);

	const cols = Math.max(1, Math.min(2, players.length));
	const width = Math.min(MAX_WIDTH, cols * 200);
	const rows = Math.max(1, Math.ceil(players.length / 2));
	const height = PADDING * 2 + rows * ROW_HEIGHT;

	const items = players.map((p, i) => {
		const col = i % 2;
		const row = Math.floor(i / 2);
		const x = PADDING + col * (width / 2);
		const y = PADDING + row * ROW_HEIGHT + AVATAR_SIZE;

		const isJoining = p.nick.endsWith(JOINING);
		const nick = isJoining ? p.nick.slice(0, -JOINING.length) : p.nick;

		const color = p.isBanned ? "#FF0000" : p.isAdmin ? "#933f93" : "#2a77be";
		const opacity = p.isAfk ? 0.4 : 1;
		const avatarDataUri = avatarDataUris[i];
		const nickX = x + (avatarDataUri ? AVATAR_SIZE + GAP : 0);

		const avatar = avatarDataUri
			? `<image href="${avatarDataUri}" x="${x}" y="${y - AVATAR_SIZE}" width="${AVATAR_SIZE}" height="${AVATAR_SIZE}" clip-path="url(#clip)"/>`
			: "";

		const indicator = isJoining
			? `<circle cx="${nickX + nick.length * 8 + 14}" cy="${y - 12}" r="4" fill="#4ade80"/>`
			: "";

		return `<g opacity="${opacity}">
			${avatar}
			<text x="${nickX}" y="${y - 4}" fill="${color}" font-size="14" font-family="sans-serif" font-weight="600">${escapeXml(nick)}</text>
			${indicator}
		</g>`;
	});

	const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">
	<defs>
		<clipPath id="clip" clipPathUnits="objectBoundingBox">
			<circle cx="0.5" cy="0.5" r="0.5"/>
		</clipPath>
	</defs>
	<rect width="${width}" height="${height}" fill="#222"/>
	<image href="${mapThumbnailDataUri}" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice"/>
	<rect width="${width}" height="${height}" fill="rgba(0,0,0,0.75)"/>
	${items.join("\n")}
</svg>`;

	return new Resvg(svg, { fitTo: { mode: "original" } }).render().asPng();
}
