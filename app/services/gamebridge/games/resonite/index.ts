import * as Discord from "discord.js";
import * as signalR from "@microsoft/signalr";
import GameBridge from "../../GameBridge.js";
import ResoniteConnection, { ResoniteSessionState } from "./ResoniteConnection.js";
import { Player } from "../../GameConnection.js";
import { ResoniteSession } from "@/app/services/Resonite.js";
import resoniteConfig from "@/config/resonite.json" with { type: "json" };
import { renderPlayerListImage } from "../../renderPlayerList.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const RESONITE_SERVER_ID = 1;
const DEFAULT_THUMBNAIL = "https://metastruct.net/img/logo.png";

function buildSessionContainer(
	session: ResoniteSession,
	mapThumbnail: string,
	attachmentName: string,
	state?: "disconnected" | "ended"
): Discord.ContainerBuilder {
	const count = session.joinedUsers;
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(state === "ended" ? 0x808080 : 4796260);

	let desc =
		`### ${session.tags[0] ?? session.name}\n` +
		`:busts_in_silhouette: Player${
			count > 1 || count == 0 ? "s" : ""
		}: **Active: ${session.activeUsers} • Connected: ${count}**\n` +
		`:door: Capacity: **${count}/${session.maxUsers}**\n` +
		`:repeat: Last Update: <t:${(new Date(session.lastUpdate).getTime() / 1000) | 0}:R>\n` +
		`:file_cabinet: Server up since: <t:${(new Date(session.sessionBeginTime).getTime() / 1000) | 0}:R>`;

	if (session.accessLevel !== "Anyone") {
		desc += `\n:closed_lock_with_key: Access: **${session.accessLevel}**`;
	}

	if (session.hideFromListing) {
		desc += `\n:no_entry_sign: Hidden from public listing`;
	}

	if (state === "ended") {
		desc = `🛑 **Headless instance offline**\n${desc}`;
	} else if (state === "disconnected") {
		desc = `⚠️ **Server disconnected** info may be outdated\n${desc}`;
	}

	container.addSectionComponents(section =>
		section
			.addTextDisplayComponents(text => text.setContent(desc))
			.setThumbnailAccessory(accessory =>
				accessory.setURL(mapThumbnail).setDescription(session.tags.join())
			)
	);

	if (count > 0 && state !== "ended") {
		container.addSeparatorComponents(sep => sep);
		container.addMediaGalleryComponents(gallery =>
			gallery.addItems(item => item.setURL(`attachment://${attachmentName}`))
		);
	}

	container.addSeparatorComponents(sep => sep);

	if (state !== "ended") {
		container.addActionRowComponents(row =>
			row.setComponents(
				new Discord.ButtonBuilder()
					.setStyle(Discord.ButtonStyle.Link)
					.setLabel("Connect")
					.setURL(`https://go.resonite.com/session/${session.sessionId}`)
			)
		);

		container.addSeparatorComponents(sep => sep);
	}

	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ Resonite"));

	return container;
}

/** Renders every currently tracked session into one message, optionally with one extra (e.g. just-ended) session appended. */
function renderMessage(
	connection: ResoniteConnection,
	opts: {
		state?: "disconnected";
		extra?: { session: ResoniteSession; mapThumbnail: string };
	} = {}
): { containers: Discord.ContainerBuilder[]; files: Discord.AttachmentBuilder[] } {
	const containers: Discord.ContainerBuilder[] = [];
	const files: Discord.AttachmentBuilder[] = [];

	for (const s of connection.sessions.values()) {
		// sessionId contains characters (e.g. ":") that break attachment://
		// URL parsing when used as-is.
		const attachmentName = `players-${s.session.sessionId.replace(/[^a-zA-Z0-9_-]/g, "_")}.png`;
		containers.push(
			buildSessionContainer(s.session, s.mapThumbnail, attachmentName, opts.state)
		);
		if (s.playerListImage) {
			files.push(new Discord.AttachmentBuilder(s.playerListImage).setName(attachmentName));
		}
	}

	if (opts.extra) {
		containers.push(
			buildSessionContainer(opts.extra.session, opts.extra.mapThumbnail, "", "ended")
		);
	}

	return { containers, files };
}

/** Fingerprint of the fields that feed the player list/composite image - excludes lastUpdate. */
function sessionContentKey(session: ResoniteSession): string {
	return JSON.stringify({
		count: session.joinedUsers,
		active: session.activeUsers,
		access: session.accessLevel,
		hidden: session.hideFromListing,
		thumbnail: session.thumbnailUrl,
		users: session.sessionUsers.map(u => `${u.userID}:${u.isPresent}`).sort(),
	});
}

/**
 * Fingerprint of only the state that should trigger a Discord edit - deliberately
 * excludes anything that ticks on its own (e.g. session.lastUpdate) so a heartbeat
 * with nothing new to report doesn't repost the message.
 */
function buildSignature(connection: ResoniteConnection): unknown {
	return {
		disconnected: connection.disconnected,
		sessions: [...connection.sessions.values()]
			.map(s => ({
				id: s.session.sessionId,
				count: s.session.joinedUsers,
				active: s.session.activeUsers,
				access: s.session.accessLevel,
				hidden: s.session.hideFromListing,
				users: s.session.sessionUsers.map(u => `${u.userID}:${u.isPresent}`).sort(),
			}))
			.sort((a, b) => a.id.localeCompare(b.id)),
	};
}

/** Drops a tracked session (explicit RemoveSession, or a hasEnded/invalid update) and re-renders. */
async function removeSession(bridge: GameBridge, sessionId: string): Promise<void> {
	const connection = bridge.servers.resonite[RESONITE_SERVER_ID];
	const ended = connection?.sessions.get(sessionId);
	if (!connection || !ended) return;

	connection.sessions.delete(sessionId);
	updatePresence(connection);

	// a custom session id (S-{hostUserId}:{label}) identifies a persistent
	// headless instance that will restart under the same id, worth a
	// lingering "offline" embed; an auto-generated S-{guid} won't recur.
	const hasCustomSessionId = ended.session.sessionId.startsWith(`S-${ended.session.hostUserId}:`);
	const { containers, files } = renderMessage(
		connection,
		hasCustomSessionId
			? { extra: { session: ended.session, mapThumbnail: ended.mapThumbnail } }
			: {}
	);
	await connection.postOrEditStatusMessage(containers, files, buildSignature(connection));

	if (connection.sessions.size === 0) {
		connection.discord.destroy();
		if (bridge.servers.resonite[RESONITE_SERVER_ID] === connection) {
			delete bridge.servers.resonite[RESONITE_SERVER_ID];
		}
	}
}

function updatePresence(connection: ResoniteConnection): void {
	const sessions = [...connection.sessions.values()];
	const totalPlayers = sessions.reduce((sum, s) => sum + s.session.joinedUsers, 0);

	if (totalPlayers > 0) {
		connection.setPresence("online", {
			activity: {
				name:
					sessions.length > 1
						? `${totalPlayers} players across ${sessions.length} sessions`
						: `${totalPlayers === 1 ? "a" : totalPlayers} player${totalPlayers !== 1 ? "s" : ""}`,
				type: Discord.ActivityType.Watching,
			},
		});
	} else {
		connection.setPresence("idle", { afk: true });
	}
}

function createConnection(bridge: GameBridge): ResoniteConnection {
	const connection = (bridge.servers.resonite[RESONITE_SERVER_ID] = new ResoniteConnection({
		bridge,
		serverConfig: {
			name: "#resonite 🇪🇺",
			id: RESONITE_SERVER_ID,
			discordToken: resoniteConfig.discordToken,
		},
	}));
	connection.discord.on("clientReady", () => {
		connection.setPresence("idle", {
			afk: true,
			state: "waiting for server connection",
		});
	});
	return connection;
}

export function attachResonite(bridge: GameBridge): void {
	const resonite = bridge.container.getService("Resonite");

	const con = new signalR.HubConnectionBuilder()
		.withUrl("https://api.resonite.com/hub", {
			headers: { Authorization: `res ${resonite.UserID}:${resonite.ResoniteToken}` },
		})
		.configureLogging(signalR.LogLevel.Error)
		.withAutomaticReconnect()
		.build();

	con.start()
		.then(() => createConnection(bridge))
		.catch(() => {});

	con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
		try {
			if (session.hostUserId !== resonite.UserID) return;

			// Resonite doesn't reliably fire RemoveSession when a headless instance
			// dies abruptly - a final ReceiveSessionUpdate marking the session
			// hasEnded/invalid is the only signal we get, so treat it the same way.
			if (session.hasEnded || !session.isValid) {
				await removeSession(bridge, session.sessionId);
				return;
			}

			// RemoveSession tears the connection down once no sessions remain, so a
			// session starting back up needs a fresh connection created here.
			const connection =
				bridge.servers.resonite[RESONITE_SERVER_ID] ?? createConnection(bridge);
			if (!connection.discord.ready) return;

			const mapThumbnail = session.thumbnailUrl ?? DEFAULT_THUMBNAIL;
			const contentKey = sessionContentKey(session);
			const prior = connection.sessions.get(session.sessionId);

			let players = prior?.players ?? [];
			let playerListImage = prior?.playerListImage;

			// only refetch avatars and re-render the composite when something that
			// actually affects them changed - a heartbeat with the same players and
			// counts has no reason to redo any of this.
			if (!prior || prior.contentKey !== contentKey) {
				players = session.sessionUsers
					.filter(u => u.userID !== resonite.UserID)
					.map(sessionUser => ({
						nick: sessionUser.username,
						isAfk: !sessionUser.isPresent,
						steamId64: "0",
						isAdmin: false,
						isBanned: false,
						ip: sessionUser.userID,
						avatar: undefined,
					}));

				// players keep the plain asset URL (this is also what the website's
				// server-list API forwards) - only the render below needs the actual
				// authenticated bytes.
				await Promise.all(
					players.map(
						async u => (u.avatar = await resonite.GetResoniteUserAvatarURL(u.ip))
					)
				);

				// assets.resonite.com can require the requester's own auth to serve the
				// bytes - fall back to the raw URL so the composite at least attempts an
				// unauthenticated fetch rather than rendering with no image at all.
				const renderPlayers: Player[] = await Promise.all(
					players.map(async p => ({
						...p,
						avatar: p.avatar
							? ((await resonite.FetchAssetDataUri(p.avatar)) ?? p.avatar)
							: undefined,
					}))
				);
				const compositeMapThumbnail =
					(await resonite.FetchAssetDataUri(mapThumbnail)) ?? mapThumbnail;

				playerListImage = await renderPlayerListImage(renderPlayers, compositeMapThumbnail);
			}

			const state: ResoniteSessionState = {
				session,
				mapThumbnail,
				players,
				playerListImage,
				contentKey,
			};
			connection.sessions.set(session.sessionId, state);

			updatePresence(connection);
			if (mapThumbnail !== connection.discordBanner) {
				connection.changeBanner(mapThumbnail);
			}

			const { containers, files } = renderMessage(connection, {
				state: connection.disconnected ? "disconnected" : undefined,
			});
			await connection.postOrEditStatusMessage(containers, files, buildSignature(connection));
		} catch (err) {
			log.error(err, "ReceiveSessionUpdate");
		}
	});

	con.on("RemoveSession", async (sessionId: string) => {
		try {
			await removeSession(bridge, sessionId);
		} catch (err) {
			log.error(err, "RemoveSession");
		}
	});

	con.onclose(async () => {
		const connection = bridge.servers.resonite[RESONITE_SERVER_ID];
		if (!connection) return;
		connection.disconnected = true;

		if (connection.sessions.size > 0) {
			try {
				const { containers, files } = renderMessage(connection, { state: "disconnected" });
				await connection.postOrEditStatusMessage(
					containers,
					files,
					buildSignature(connection)
				);
			} catch (err) {
				log.error(err, "failed to post disconnect status");
			}
		}

		connection.discord.destroy();
		if (bridge.servers.resonite[RESONITE_SERVER_ID] === connection) {
			delete bridge.servers.resonite[RESONITE_SERVER_ID];
		}
	});
	con.onreconnected(() => {
		const connection = bridge.servers.resonite[RESONITE_SERVER_ID];
		if (!connection) return;
		connection.disconnected = false;
		updatePresence(connection);
	});
}
