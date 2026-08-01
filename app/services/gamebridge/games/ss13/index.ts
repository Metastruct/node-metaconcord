import * as Discord from "discord.js";
import GameBridge from "../../GameBridge.js";
import { Player } from "../../GameConnection.js";
import { renderPlayerListImage } from "../../renderPlayerList.js";
import SS13Connection, { SS13Status } from "./SS13Connection.js";
import { WatchdogStatus, getDreamDaemonStatus } from "./tgsClient.js";
import { getServerStatus, getPlayerList } from "./topics.js";
import config from "@/config/ss13.json" with { type: "json" };
import { logger } from "@/utils.js";
import dayjs from "dayjs";
import duration from "dayjs/plugin/duration.js";

dayjs.extend(duration);

const log = logger(import.meta);

const SS13_SERVER_ID = 10;
const POLL_INTERVAL_MS = 60_000;

const STATUS_TEXT: Record<WatchdogStatus, string> = {
	[WatchdogStatus.Offline]: "🔴 Offline",
	[WatchdogStatus.Restoring]: "🟡 Restoring",
	[WatchdogStatus.Online]: "🟢 Online",
	[WatchdogStatus.DelayedRestart]: "🟡 Delayed Restart",
};

const STATUS_COLOR: Record<WatchdogStatus, number> = {
	[WatchdogStatus.Offline]: 0xb54343,
	[WatchdogStatus.Restoring]: 0xdcb400,
	[WatchdogStatus.Online]: 0x4bb543,
	[WatchdogStatus.DelayedRestart]: 0xdcb400,
};

const SHUTTLE_AT_REST = ["idle", "docked"];

function buildStatusContainer(
	name: string,
	host: string,
	status: SS13Status,
	hasPlayerListImage: boolean,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(STATUS_COLOR[status.watchdogStatus]);

	let desc = `### ${status.mapName ?? name}`;

	if (status.watchdogStatus !== WatchdogStatus.Online) {
		desc += `\n${STATUS_TEXT[status.watchdogStatus]}`;
	}

	if (status.watchdogStatus === WatchdogStatus.Online) {
		desc += `\n:busts_in_silhouette: Player${
			status.clientCount === 1 ? "" : "s"
		}: **Active: ${status.activePlayers} • Connected: ${status.clientCount}**`;
		if (status.roundDuration) {
			desc += `\n:hourglass_flowing_sand: Round Time: \`${dayjs.duration(status.roundDuration, "seconds").format("HH:mm:ss")}\``;
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
	}

	if (status.launchTime) {
		desc += `\n:file_cabinet: Server up since: <t:${(new Date(status.launchTime).getTime() / 1000) | 0}:R>`;
	}

	// Discord's button URL validation only allows http:/https:/discord: - byond:// links
	// have to be shown as plain (copyable) text instead of a Link button.
	if (status.watchdogStatus === WatchdogStatus.Online && status.port) {
		desc += `\n:desktop: Connect: \`byond://${host}:${status.port}\``;
	}

	if (disconnected) {
		desc = `⚠️ **Server disconnected** info may be outdated\n${desc}`;
	}

	container.addTextDisplayComponents(text => text.setContent(desc));

	if (hasPlayerListImage) {
		container.addSeparatorComponents(sep => sep);
		container.addMediaGalleryComponents(gallery =>
			gallery.addItems(item => item.setURL("attachment://players.png"))
		);
	}

	container.addSeparatorComponents(sep => sep);

	const footer =
		status.roundId && status.identifier
			? `-# metastruct @ ${status.identifier} (round: ${status.roundId})`
			: "-# metastruct @ SS13";
	container.addTextDisplayComponents(text => text.setContent(footer));

	return container;
}

export function attachSS13(bridge: GameBridge): void {
	const host = new URL(config.baseUrl).hostname;
	let connection: SS13Connection | undefined;

	const poll = async () => {
		if (!connection) {
			connection = bridge.servers[SS13_SERVER_ID] = new SS13Connection({
				bridge,
				serverConfig: {
					name: "#ss13 🇪🇺",
					id: SS13_SERVER_ID,
					discordToken: config.discordToken,
				},
			});
		}
		const conn = connection;

		try {
			const dd = await getDreamDaemonStatus();
			const status: SS13Status = {
				watchdogStatus: dd.status ?? WatchdogStatus.Offline,
				clientCount: dd.clientCount ?? 0,
				launchTime: dd.launchTime ?? undefined,
				port: dd.currentPort ?? undefined,
				revision: dd.activeCompileJob?.revisionInformation?.commitSha,
			};

			// The map/round/roster topics talk directly to DreamDaemon's game port, so
			// they're only reachable once the watchdog reports the world as up. Their
			// failure (bad comms key, firewalled port, ...) shouldn't take down the
			// rest of the status embed - fall back to the aggregate TGS data.
			if (status.watchdogStatus === WatchdogStatus.Online && status.port) {
				try {
					Object.assign(
						status,
						await getServerStatus(host, status.port, config.commsKey)
					);
				} catch (err) {
					log.warn(err, "SS13 status topic query failed");
				}

				if (config.commsKey) {
					try {
						const roster = await getPlayerList(host, status.port, config.commsKey);
						conn.status.players = roster.map((p): Player => ({
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
						conn.status.players = [];
					}
				}
			} else {
				conn.status.players = [];
			}

			const files: Discord.AttachmentBuilder[] = [];
			if (conn.status.players.length > 0) {
				conn.playerListImage = await renderPlayerListImage(conn.status.players);
				files.push(
					new Discord.AttachmentBuilder(conn.playerListImage).setName("players.png")
				);
			}

			conn.lastStatus = status;
			conn.disconnected = false;

			if (status.watchdogStatus !== WatchdogStatus.Online) {
				conn.setPresence("dnd", { state: STATUS_TEXT[status.watchdogStatus] });
			} else if (status.clientCount > 0) {
				conn.setPresence("online", {
					activity: {
						name: `${status.clientCount} player${status.clientCount === 1 ? "" : "s"}`,
						type: Discord.ActivityType.Watching,
					},
				});
			} else {
				conn.setPresence("idle", { afk: true });
			}

			const container = buildStatusContainer(
				conn.config.name,
				host,
				status,
				files.length > 0,
				false
			);
			await conn.postOrEditStatusMessage(container, files);
		} catch (err) {
			log.error(err, "SS13 poll failed");
			conn.disconnected = true;
			conn.setPresence("idle", { afk: true });

			if (conn.lastStatus) {
				try {
					const files =
						conn.status.players.length > 0
							? [
									new Discord.AttachmentBuilder(conn.playerListImage).setName(
										"players.png"
									),
								]
							: [];
					const container = buildStatusContainer(
						conn.config.name,
						host,
						conn.lastStatus,
						files.length > 0,
						true
					);
					await conn.postOrEditStatusMessage(container, files);
				} catch (postErr) {
					log.error(postErr, "failed to post SS13 disconnect status");
				}
			}
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);
}
