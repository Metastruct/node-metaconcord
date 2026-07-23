import * as Discord from "discord.js";
import GameBridge from "../../GameBridge.js";
import SS13Connection, { SS13Status } from "./SS13Connection.js";
import { WatchdogStatus, getDreamDaemonStatus } from "./tgsClient.js";
import config from "@/config/ss13.json" with { type: "json" };
import { logger } from "@/utils.js";

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

function buildStatusContainer(
	name: string,
	host: string,
	status: SS13Status,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(STATUS_COLOR[status.watchdogStatus]);

	let desc = `### ${name}\n${STATUS_TEXT[status.watchdogStatus]}`;

	if (status.watchdogStatus === WatchdogStatus.Online) {
		desc += `\n:busts_in_silhouette: Player${
			status.clientCount === 1 ? "" : "s"
		}: **${status.clientCount}**`;
	}

	if (status.launchTime) {
		desc += `\n:repeat: Launched: <t:${(new Date(status.launchTime).getTime() / 1000) | 0}:R>`;
	}

	if (disconnected) {
		desc = `⚠️ **Server disconnected** info may be outdated\n${desc}`;
	}

	container.addTextDisplayComponents(text => text.setContent(desc));

	container.addSeparatorComponents(sep => sep);

	if (status.watchdogStatus === WatchdogStatus.Online && status.port) {
		container.addActionRowComponents(row =>
			row.setComponents(
				new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Link)
					.setLabel("Connect")
					.setURL(`byond://${host}:${status.port}`)
			)
		);
		container.addSeparatorComponents(sep => sep);
	}

	const footer = status.revision
		? `-# metastruct @ SS13 (${status.revision.substring(0, 8)})`
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
					name: "#ss13",
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

			conn.lastStatus = status;
			conn.disconnected = false;

			const presence: Discord.PresenceData =
				status.watchdogStatus === WatchdogStatus.Offline
					? { status: "dnd", activities: [] }
					: status.watchdogStatus === WatchdogStatus.Online && status.clientCount > 0
						? {
								status: "online",
								activities: [
									{
										name: `${status.clientCount} player${status.clientCount === 1 ? "" : "s"}`,
										type: 3,
									},
								],
							}
						: { status: "idle", afk: true, activities: [] };

			conn.discord.user?.setPresence(presence);

			const container = buildStatusContainer(conn.config.name, host, status, false);
			await conn.postOrEditStatusMessage(container, []);
		} catch (err) {
			log.error(err, "SS13 poll failed");
			conn.disconnected = true;
			conn.discord.user?.setPresence({ status: "idle", afk: true, activities: [] });

			if (conn.lastStatus) {
				try {
					const container = buildStatusContainer(
						conn.config.name,
						host,
						conn.lastStatus,
						true
					);
					await conn.postOrEditStatusMessage(container, []);
				} catch (postErr) {
					log.error(postErr, "failed to post SS13 disconnect status");
				}
			}
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);
}
