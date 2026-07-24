import * as Discord from "discord.js";
import * as signalR from "@microsoft/signalr";
import GameBridge from "../../GameBridge.js";
import ResoniteConnection from "./ResoniteConnection.js";
import { ResoniteSession } from "@/app/services/Resonite.js";
import resoniteConfig from "@/config/resonite.json" with { type: "json" };
import { renderPlayerListImage } from "../../renderPlayerList.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const RESONITE_SERVER_ID = 9;

function buildStatusContainer(
	session: ResoniteSession,
	mapThumbnail: string,
	disconnected: boolean
): Discord.ContainerBuilder {
	const count = session.joinedUsers;
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(4796260);

	let desc =
		`### ${session.tags[0] ?? session.name}\n` +
		`:busts_in_silhouette: Player${
			count > 1 || count == 0 ? "s" : ""
		}: **${session.activeUsers}/${count}**\n` +
		`:repeat: Last Update: <t:${(new Date(session.lastUpdate).getTime() / 1000) | 0}:R>\n` +
		`:file_cabinet: Server up since: <t:${(new Date(session.sessionBeginTime).getTime() / 1000) | 0}:R>`;

	if (disconnected) {
		desc = `⚠️ **Server disconnected** info may be outdated\n${desc}`;
	}

	container.addSectionComponents(section =>
		section
			.addTextDisplayComponents(text => text.setContent(desc))
			.setThumbnailAccessory(accessory =>
				accessory.setURL(mapThumbnail).setDescription(session.tags.join())
			)
	);

	if (count > 0) {
		container.addSeparatorComponents(sep => sep);
		container.addMediaGalleryComponents(gallery =>
			gallery.addItems(item => item.setURL("attachment://players.png"))
		);
	}

	container.addSeparatorComponents(sep => sep);

	container.addActionRowComponents(row =>
		row.setComponents(
			new Discord.ButtonBuilder()
				.setStyle(Discord.ButtonStyle.Link)
				.setLabel("Connect")
				.setURL(`https://go.resonite.com/session/${session.sessionId}`)
		)
	);

	container.addSeparatorComponents(sep => sep);

	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ Resonite"));

	return container;
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
		.then(() => {
			const connection = (bridge.servers[RESONITE_SERVER_ID] = new ResoniteConnection({
				bridge,
				serverConfig: {
					name: "#resonite 🇪🇺",
					id: RESONITE_SERVER_ID,
					discordToken: resoniteConfig.discordToken,
				},
			}));
			connection.discord.on("clientReady", () => {
				connection.discord.user?.setPresence({
					status: "idle",
					afk: true,
					activities: [
						{
							name: "connecting",
							state: "waiting for server connection",
							type: 4,
						},
					],
				});
				if (connection.status.mapThumbnail)
					connection.changeBanner(connection.status.mapThumbnail);
			});
		})
		.catch(() => {});

	let lastCount = 1;
	con.on("ReceiveSessionUpdate", async (session: ResoniteSession) => {
		try {
			const connection = bridge.servers[RESONITE_SERVER_ID];
			if (!(connection instanceof ResoniteConnection)) throw new Error("Server not found");
			if (session.hostUserId !== resonite.UserID) return;

			const discord = connection.discord;
			const count = session.joinedUsers;

			// update until last person leaves
			if (!discord.ready || (lastCount === count && count === 0)) return;
			lastCount = count;

			const presence: Discord.PresenceData =
				count > 0
					? {
							status: "online",
							activities: [
								{
									name: `${count === 1 ? "a" : count} player${count !== 1 ? "s" : ""}`,
									type: 3,
								},
							],
						}
					: {
							status: "idle",
							afk: true,
							activities: [],
						};

			discord.user?.setPresence(presence);

			const mapThumbnail = session.thumbnailUrl ?? "https://metastruct.net/img/logo.png";
			connection.changeBanner(mapThumbnail);
			connection.status.mapThumbnail = mapThumbnail;

			connection.status.players = session.sessionUsers
				.filter(u => u.userID !== resonite.UserID)
				.map(sessionUser => {
					return {
						nick: sessionUser.username,
						isAfk: !sessionUser.isPresent,
						steamId64: "0",
						isAdmin: false,
						isBanned: false,
						ip: sessionUser.userID,
						avatar: undefined,
					};
				});

			connection.status.players.forEach(
				async u => (u.avatar = await resonite.GetResoniteUserAvatarURL(u.ip))
			);

			connection.playerListImage = await renderPlayerListImage(
				connection.status.players,
				mapThumbnail
			);
			connection.lastSession = session;

			const container = buildStatusContainer(session, mapThumbnail, connection.disconnected);
			await connection.postOrEditStatusMessage(container, [
				new Discord.AttachmentBuilder(connection.playerListImage).setName("players.png"),
			]);
		} catch (err) {
			log.error(err, "ReceiveSessionUpdate");
		}
	});

	con.onclose(async () => {
		const connection = bridge.servers[RESONITE_SERVER_ID];
		if (!(connection instanceof ResoniteConnection)) return;
		connection.disconnected = true;
		connection.discord.user?.setPresence({
			status: "dnd",
			activities: [{ name: "connecting", state: "lost connection", type: 4 }],
		});

		if (!connection.lastSession || !connection.status.mapThumbnail) return;
		try {
			const container = buildStatusContainer(
				connection.lastSession,
				connection.status.mapThumbnail,
				true
			);
			await connection.postOrEditStatusMessage(container, [
				new Discord.AttachmentBuilder(connection.playerListImage).setName("players.png"),
			]);
		} catch (err) {
			log.error(err, "failed to post disconnect status");
		}
	});
	con.onreconnected(() => {
		const connection = bridge.servers[RESONITE_SERVER_ID];
		if (!connection) return;
		connection.disconnected = false;
		connection.discord.user?.setPresence({ status: "idle", afk: true });
	});
}
