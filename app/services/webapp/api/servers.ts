import { GameState } from "@/app/services/gamebridge/games/ss13/topics.js";
import type { Player } from "@/app/services/gamebridge/GameConnection.js";
import { WatchdogStatus } from "@/app/services/gamebridge/games/ss13/tgsClient.js";
import type { WebApp } from "@/app/services/webapp/index.js";
import { promises as dns } from "dns";
import path from "path";
import ss13Config from "@/config/ss13.json" with { type: "json" };
import vrchatConfig from "@/config/vrchat.json" with { type: "json" };

/**
 * Live server/instance list for the website, one group per game. Only games with
 * something online are included; disconnected servers are omitted.
 */
export type ServerGame = "gmod" | "minecraft" | "ss13" | "resonite" | "vrchat";

export interface ServerPlayer {
	id: string;
	nick: string;
	avatar?: string;
	profileUrl?: string;
	isAdmin?: boolean;
	isAfk?: boolean;
	description?: string;
	entIndex?: number;
}

export interface ServerEntry {
	id: number | string;
	key: string;
	name: string;
	map?: string;
	mode?: string;
	thumbnail?: string;
	players: ServerPlayer[];
	playerCount: number;
	maxPlayers?: number;
	upSince?: number;
	connect?: { url?: string; address?: string; port?: number; ip?: string; label?: string };
	extra?: Record<string, string>;
}

export interface GameEntry {
	game: ServerGame;
	label: string;
	kind: "server" | "instance";
	entries: ServerEntry[];
}

const GAME_LABELS: Record<ServerGame, string> = {
	gmod: "Garry's Mod",
	minecraft: "Minecraft",
	ss13: "Space Station 13",
	resonite: "Resonite",
	vrchat: "VRChat",
};

const DNS_TTL = 10 * 60 * 1000;
const dnsCache = new Map<string, { ip: string; expires: number }>();

export async function resolveIp(hostname: string): Promise<string | undefined> {
	if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) return hostname;
	const cached = dnsCache.get(hostname);
	if (cached && cached.expires > Date.now()) return cached.ip;
	try {
		const [ip] = await dns.resolve4(hostname);
		if (ip) dnsCache.set(hostname, { ip, expires: Date.now() + DNS_TTL });
		return ip ?? cached?.ip;
	} catch {
		return cached?.ip;
	}
}

function thumbnailUrl(baseUrl: string, thumbnail?: string): string | undefined {
	if (!thumbnail) return;
	if (/^https?:\/\//.test(thumbnail)) return thumbnail;
	// local file under resources/map-thumbnails, served by resources.ts
	return `${baseUrl.replace(/\/$/, "")}/map-thumbnails/${path.basename(thumbnail)}`;
}

function basePlayer(player: Player): ServerPlayer {
	return {
		id: player.steamId64,
		nick: player.nick,
		avatar: player.avatar || undefined,
		isAdmin: player.isAdmin || undefined,
		isAfk: player.isAfk || undefined,
		description: player.description,
		entIndex: player.entIndex,
	};
}

export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/servers", async (_, res) => {
		const bridge = webApp.container.getService("GameBridge");
		const baseUrl = webApp.config.url;
		const games: GameEntry[] = [];

		// gmod
		const gmod: ServerEntry[] = [];
		for (const server of Object.values(bridge.servers.gmod)) {
			if (!server || server.disconnected || !server.wsConnection?.connected) continue;
			const { config } = server;
			const sandbox = server.gamemode?.folderName?.toLowerCase().includes("sandbox");
			gmod.push({
				id: config.id,
				key: `gmod-${config.id}`,
				name: config.name,
				map: server.mapName,
				mode: sandbox ? undefined : server.gamemode?.name,
				thumbnail: thumbnailUrl(baseUrl, server.status.mapThumbnail),
				players: server.status.players.map(p => ({
					...basePlayer(p),
					profileUrl: /^\d+$/.test(p.steamId64)
						? `https://steamcommunity.com/profiles/${p.steamId64}`
						: undefined,
				})),
				playerCount: server.status.players.length,
				upSince: server.serverUpSince,
				connect: {
					address: config.address,
					port: config.port,
					ip: config.address ? await resolveIp(config.address) : undefined,
					label: config.label || undefined,
				},
				extra: server.hostname ? { hostname: server.hostname } : undefined,
			});
		}
		if (gmod.length)
			games.push({ game: "gmod", label: GAME_LABELS.gmod, kind: "server", entries: gmod });

		// minecraft
		const minecraft: ServerEntry[] = [];
		for (const server of Object.values(bridge.servers.minecraft)) {
			if (!server || server.disconnected || !server.wsConnection?.connected) continue;
			const { config, lastStatus } = server;
			minecraft.push({
				id: config.id,
				key: `minecraft-${config.id}`,
				name: config.name,
				map: lastStatus?.hostname,
				thumbnail: thumbnailUrl(baseUrl, server.status.mapThumbnail),
				players: server.status.players.map(p => ({
					...basePlayer(p),
					profileUrl: `https://namemc.com/profile/${p.steamId64}`,
				})),
				playerCount: server.status.players.length,
				maxPlayers: lastStatus?.maxPlayers,
				upSince: lastStatus ? lastStatus.upSince * 1000 : undefined,
				connect: config.address ? { address: config.address } : undefined,
				extra: lastStatus?.version ? { version: lastStatus.version } : undefined,
			});
		}
		if (minecraft.length) {
			games.push({
				game: "minecraft",
				label: GAME_LABELS.minecraft,
				kind: "server",
				entries: minecraft,
			});
		}

		// ss13
		const ss13: ServerEntry[] = [];
		for (const server of Object.values(bridge.servers.ss13)) {
			const status = server?.lastStatus;
			if (!server || server.disconnected || !status) continue;
			if (status.watchdogStatus !== WatchdogStatus.Online) continue;
			const host = new URL(ss13Config.baseUrl).hostname;
			const extra: Record<string, string> = {};
			if (status.roundId) extra.round = String(status.roundId);
			if (status.securityLevel) extra.securityLevel = status.securityLevel;
			if (status.shuttleMode) extra.shuttle = status.shuttleMode;
			ss13.push({
				id: server.config.id,
				key: `ss13-${server.config.id}`,
				name: server.config.name,
				map: status.mapName,
				mode: status.gamestate !== undefined ? GameState[status.gamestate] : undefined,
				thumbnail: thumbnailUrl(baseUrl, server.status.mapThumbnail),
				players: server.status.players.map(basePlayer),
				playerCount: server.status.players.length,
				maxPlayers: status.popcap || undefined,
				upSince: status.launchTime ? Date.parse(status.launchTime) || undefined : undefined,
				connect: status.port ? { url: `byond://${host}:${status.port}` } : undefined,
				extra: Object.keys(extra).length ? extra : undefined,
			});
		}
		if (ss13.length)
			games.push({ game: "ss13", label: GAME_LABELS.ss13, kind: "server", entries: ss13 });

		// resonite: one instance per active session (a single connection can host several)
		const resonite: ServerEntry[] = [];
		for (const server of Object.values(bridge.servers.resonite)) {
			if (!server || server.disconnected) continue;
			for (const { session, mapThumbnail, players } of server.sessions.values()) {
				if (session.hasEnded) continue;
				resonite.push({
					id: session.sessionId,
					key: `resonite-${session.sessionId}`,
					name: session.tags?.[0] ?? session.name,
					map: session.tags?.[0] ? session.name : undefined,
					mode: session.accessLevel,
					thumbnail: session.thumbnailUrl || thumbnailUrl(baseUrl, mapThumbnail),
					players: players.map(p => ({
						...basePlayer(p),
						id: p.ip,
						profileUrl: p.ip ? `https://go.resonite.com/user/${p.ip}` : undefined,
					})),
					playerCount: players.length,
					maxPlayers: session.maxUsers || undefined,
					upSince: session.sessionBeginTime
						? new Date(session.sessionBeginTime).getTime() || undefined
						: undefined,
					connect: { url: `https://go.resonite.com/session/${session.sessionId}` },
				});
			}
		}
		if (resonite.length) {
			games.push({
				game: "resonite",
				label: GAME_LABELS.resonite,
				kind: "instance",
				entries: resonite,
			});
		}

		// vrchat: one entry per open group instance (VRChat exposes no player roster),
		// or the group itself when nothing is open, as long as the poll succeeded.
		const vrchat: ServerEntry[] = [];
		for (const server of Object.values(bridge.servers.vrchat)) {
			if (!server || server.disconnected || !server.lastInstances) continue;
			for (const instance of server.lastInstances) {
				vrchat.push({
					id: instance.instanceId,
					key: `vrchat-${instance.world.id}-${instance.instanceId}`,
					name: instance.world.name,
					thumbnail:
						instance.world.thumbnailImageUrl || instance.world.imageUrl || undefined,
					players: [],
					playerCount: instance.memberCount,
					maxPlayers: instance.world.capacity || undefined,
					connect: {
						url: `https://vrchat.com/home/launch?worldId=${instance.world.id}&instanceId=${instance.instanceId}`,
					},
				});
			}
			if (!server.lastInstances.length) {
				const group = server.group;
				vrchat.push({
					id: vrchatConfig.groupId,
					key: `vrchat-group-${vrchatConfig.groupId}`,
					name: group?.name ?? server.config.name,
					thumbnail: group?.bannerUrl || group?.iconUrl || undefined,
					players: [],
					playerCount: 0,
					extra: { status: "No instance open right now" },
					connect: { url: `https://vrchat.com/home/group/${vrchatConfig.groupId}` },
				});
			}
		}
		if (vrchat.length) {
			games.push({
				game: "vrchat",
				label: GAME_LABELS.vrchat,
				kind: "instance",
				entries: vrchat,
			});
		}

		res.set("Cache-Control", "public, max-age=5");
		res.json({ games });
	});
};
