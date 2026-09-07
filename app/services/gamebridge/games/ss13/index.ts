import * as Discord from "discord.js";
import GameBridge from "../../GameBridge.js";
import { Player } from "../../GameConnection.js";
import { renderPlayerListImage } from "../../renderPlayerList.js";
import SS13Connection, { SS13InstanceState, SS13Status } from "./SS13Connection.js";
import { WatchdogStatus, getDreamDaemonStatus, getInstance } from "./tgsClient.js";
import { getServerStatus, getPlayerList } from "./topics.js";
import { queryTopic } from "./byondTopic.js";
import config from "@/config/ss13.json" with { type: "json" };
import { logger } from "@/utils.js";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";

dayjs.extend(duration);

const log = logger(import.meta);

const SS13_SERVER_ID = 1;
const POLL_INTERVAL_MS = 60_000;

type SS13InstanceConfig = {
	instanceId: number;
	commsKey?: string;
	watchedRepo?: string;
};

// only instances whose watchdog reports Online ever reach buildInstanceContainer.
const ONLINE_COLOR = 0x4bb543;

const SHUTTLE_AT_REST = ["idle", "docked"];

/**
 * Fingerprint of only the state that should trigger a Discord edit - deliberately
 * excludes anything that ticks on its own (e.g. round duration) so a 60s poll
 * with nothing new to report doesn't repost the message.
 */
function buildSignature(connection: SS13Connection, disconnected: boolean): unknown {
	return {
		disconnected,
		instances: [...connection.instances.entries()]
			.map(([instanceId, s]) => ({
				instanceId,
				clientCount: s.status.clientCount,
				roundId: s.status.roundId,
				securityLevel: s.status.securityLevel,
				shuttleMode: s.status.shuttleMode,
				port: s.status.port,
				players: s.players
					.map(p => ({ nick: p.nick, isAfk: p.isAfk, description: p.description }))
					.sort((a, b) => a.nick.localeCompare(b.nick)),
			}))
			.sort((a, b) => a.instanceId - b.instanceId),
	};
}

function buildInstanceContainer(
	name: string,
	host: string,
	status: SS13Status,
	hasPlayerListImage: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(ONLINE_COLOR);

	let desc = `### ${status.mapName ?? name}`;

	desc += `\n:busts_in_silhouette: Player${
		status.clientCount === 1 ? "" : "s"
	}: **${status.activePlayers ? `Active: ${status.activePlayers} • ` : ""}Connected: ${status.clientCount}**`;
	if (status.roundDuration) {
		const dur = dayjs.duration(status.roundDuration, "seconds");
		const hours = Math.floor(dur.asHours());
		desc += `\n:hourglass_flowing_sand: Round Time: \`${hours.toString().padStart(2, "0")}:${dur.format("mm:ss")}\``;
	}

	if (status.securityLevel) {
		desc += `\n:rotating_light: Security Level: **${status.securityLevel}**`;
	}

	if (status.shuttleMode && !SHUTTLE_AT_REST.includes(status.shuttleMode)) {
		desc += `\n:rocket: Shuttle: **${status.shuttleMode}**`;
		if (status.shuttleTimer) {
			desc += ` (<t:${(Date.now() / 1000 + status.shuttleTimer) | 0}:R>)`;
		}
	}

	if (status.launchTime) {
		desc += `\n:file_cabinet: Server up since: <t:${(new Date(status.launchTime).getTime() / 1000) | 0}:R>`;
	}

	// Discord's button URL validation only allows http:/https:/discord: - byond:// links
	// have to be shown as plain (copyable) text instead of a Link button.
	if (status.port) {
		desc += `\n:desktop: Connect: \`byond://${host}:${status.port}\``;
	}

	container.addTextDisplayComponents(text => text.setContent(desc));

	if (hasPlayerListImage) {
		container.addSeparatorComponents(sep => sep);
		container.addMediaGalleryComponents(gallery =>
			gallery.addItems(item => item.setURL(`attachment://players-${status.port}.png`))
		);
	}

	container.addSeparatorComponents(sep => sep);

	const footer = `-# metastruct @ ${name}${status.roundId ? ` (round: ${status.roundId})` : ""}`;
	container.addTextDisplayComponents(text => text.setContent(footer));

	return container;
}

/** Renders every currently online instance into one message. */
function renderMessage(
	connection: SS13Connection,
	host: string
): { containers: Discord.ContainerBuilder[]; files: Discord.AttachmentBuilder[] } {
	const containers: Discord.ContainerBuilder[] = [];
	const files: Discord.AttachmentBuilder[] = [];

	for (const state of connection.instances.values()) {
		containers.push(
			buildInstanceContainer(state.name, host, state.status, !!state.playerListImage)
		);
		if (state.playerListImage) {
			files.push(
				new Discord.AttachmentBuilder(state.playerListImage).setName(
					`players-${state.status.port}.png`
				)
			);
		}
	}

	return { containers, files };
}

function updatePresence(connection: SS13Connection): void {
	const states = [...connection.instances.values()];
	const totalPlayers = states.reduce((sum, s) => sum + s.status.clientCount, 0);

	if (states.length === 0) {
		connection.setPresence("dnd", { state: "🔴 No instances online" });
	} else if (totalPlayers > 0) {
		connection.setPresence("online", {
			activity: {
				name:
					states.length > 1
						? `${totalPlayers} players across ${states.length} servers`
						: `${totalPlayers} player${totalPlayers === 1 ? "" : "s"}`,
				type: Discord.ActivityType.Watching,
			},
		});
	} else {
		connection.setPresence("idle", { afk: true });
	}
}

/** Polls one configured TGS instance, returning its state or undefined if it shouldn't be shown (detached, disabled, or watchdog not online). */
async function pollInstance(
	host: string,
	instanceConfig: SS13InstanceConfig
): Promise<SS13InstanceState | undefined> {
	const instance = await getInstance(instanceConfig.instanceId);
	if (!instance.online) return undefined;

	const dd = await getDreamDaemonStatus(instanceConfig.instanceId);
	const status: SS13Status = {
		watchdogStatus: dd.status ?? WatchdogStatus.Offline,
		clientCount: dd.clientCount ?? 0,
		launchTime: dd.launchTime ?? undefined,
		port: dd.currentPort ?? undefined,
		revision: dd.activeCompileJob?.revisionInformation?.commitSha,
	};

	if (status.watchdogStatus !== WatchdogStatus.Online || !status.port) return undefined;

	// The map/round/roster topics talk directly to DreamDaemon's game port, so
	// they're only reachable once the watchdog reports the world as up. Their
	// failure (bad comms key, firewalled port, ...) shouldn't take down the
	// rest of the status embed - fall back to the aggregate TGS data.
	try {
		Object.assign(status, await getServerStatus(host, status.port, instanceConfig.commsKey));
	} catch (err) {
		log.warn(err, "SS13 status topic query failed");
	}

	let players: Player[] = [];
	if (instanceConfig.commsKey) {
		try {
			const roster = await getPlayerList(host, status.port, instanceConfig.commsKey);
			players = roster.map((p): Player => ({
				nick: p.name,
				avatar: p.headshot,
				isAfk: p.afk === 1,
				description: p.job ? `(as ${p.job})` : undefined,
				steamId64: "",
				isAdmin: false,
				isBanned: false,
				ip: "",
			}));
		} catch (err) {
			log.warn(err, "SS13 playerlist topic query failed");
		}
	}

	const playerListImage = players.length > 0 ? await renderPlayerListImage(players) : undefined;

	return { name: instance.name, status, players, playerListImage };
}

export function attachSS13(bridge: GameBridge): void {
	const host = new URL(config.baseUrl).hostname;
	let connection: SS13Connection | undefined;

	const poll = async () => {
		if (!connection) {
			connection = bridge.servers.ss13[SS13_SERVER_ID] = new SS13Connection({
				bridge,
				serverConfig: {
					name: "#ss13 🇪🇺",
					id: SS13_SERVER_ID,
					discordToken: config.discordToken,
				},
			});
		}
		const conn = connection;

		let anySucceeded = false;
		for (const instanceConfig of config.instances as SS13InstanceConfig[]) {
			try {
				const state = await pollInstance(host, instanceConfig);
				anySucceeded = true;
				if (state) {
					conn.instances.set(instanceConfig.instanceId, state);
				} else {
					conn.instances.delete(instanceConfig.instanceId);
				}
			} catch (err) {
				log.warn(
					{ err, instanceId: instanceConfig.instanceId },
					"SS13 instance poll failed"
				);
				conn.instances.delete(instanceConfig.instanceId);
			}
		}

		conn.disconnected = !anySucceeded && conn.instances.size === 0;
		updatePresence(conn);

		try {
			const { containers, files } = renderMessage(conn, host);
			await conn.postOrEditStatusMessage(
				containers,
				files,
				buildSignature(conn, conn.disconnected)
			);
		} catch (err) {
			log.error(err, "failed to post SS13 status");
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);

	bridge.events.on("githubPush", async payload => {
		const conn = bridge.servers.ss13[SS13_SERVER_ID];
		if (!conn) return;

		for (const instanceConfig of config.instances as SS13InstanceConfig[]) {
			if (payload.repo !== instanceConfig.watchedRepo || !instanceConfig.commsKey) continue;

			const state = conn.instances.get(instanceConfig.instanceId);
			if (!state?.status.port) continue;

			const data = JSON.stringify(
				payload.commits.map(c => ({
					author: c.author,
					message: c.message,
					hash: c.hash,
				}))
			);

			const query = `commits&key=${encodeURIComponent(instanceConfig.commsKey)}&branch=${encodeURIComponent(payload.branch)}&data=${encodeURIComponent(data)}`;

			try {
				await queryTopic(host, state.status.port, query);
			} catch (err) {
				log.warn({ err, repo: payload.repo }, "failed to send commits to SS13");
			}
		}
	});
}
