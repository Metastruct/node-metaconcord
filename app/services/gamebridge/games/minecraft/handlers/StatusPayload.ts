import * as Discord from "discord.js";

import { localeCompare, logger } from "#utils";
import { renderPlayerListImage } from "../../../renderPlayerList.js";
import { renderHeadDataUri } from "../headRender.js";
import type {
	default as MinecraftConnection,
	MinecraftStatus,
} from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import { type StatusRequest } from "./structures/index.js";
import requestSchema from "./structures/StatusRequest.json" with { type: "json" };

const log = logger(import.meta);

/**
 * Fingerprint of only the state that should trigger a Discord edit - deliberately
 * excludes anything that ticks on its own (e.g. upSince) so a heartbeat with
 * nothing new to report doesn't repost the message.
 */
function buildSignature(
	status: MinecraftStatus,
	players: MinecraftConnection["status"]["players"],
	disconnected: boolean
): unknown {
	return {
		disconnected,
		hostname: status.hostname,
		version: status.version,
		maxPlayers: status.maxPlayers,
		players: players.map(p => p.id).toSorted(localeCompare),
	};
}

function buildStatusContainer(
	server: MinecraftConnection,
	status: MinecraftStatus,
	playerCount: number,
	hasPlayerListImage: boolean,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(disconnected ? 0xB5_43_43 : 0x4B_B5_43);

	let desc =
		`### ${status.hostname}\n` +
		`:busts_in_silhouette: Player${
			playerCount === 1 ? "" : "s"
		}: **Connected: ${playerCount} / ${status.maxPlayers}**\n` +
		`:hammer_pick: Version: **${status.version}**\n` +
		`:file_cabinet: Server up since: <t:${status.upSince}:R>`;

	if (server.config.address) {
		desc += `\n:desktop: Connect: \`${server.config.address}\``;
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

	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ Minecraft"));

	return container;
}

export default class StatusPayload extends Payload {
	protected static override requestSchema = requestSchema;

	static override async handle(payload: StatusRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { hostname, version, maxPlayers, uptime, players } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		server.status.players = players.map(player => ({
			id: player.uuid,
			nick: player.nick,
			avatar: `https://mc-heads.net/avatar/${player.uuid}`,
		}));

		const count = server.status.players.length;
		if (count > 0) {
			server.setPresence("online", {
				activity: {
					name: `${count} player${count === 1 ? "" : "s"}`,
					type: Discord.ActivityType.Watching,
				},
			});
		} else {
			server.setPresence("idle", { afk: true });
		}

		server.lastStatus = {
			hostname,
			version,
			maxPlayers,
			upSince: Math.trunc(Date.now() / 1000) - uptime,
		};

		const files: Discord.AttachmentBuilder[] = [];
		if (count > 0) {
			try {
				const renderPlayers = await Promise.all(
					server.status.players.map(async player => ({
						...player,
						avatar: (await renderHeadDataUri(player.id)) ?? player.avatar,
					}))
				);
				server.playerListImage = await renderPlayerListImage(
					renderPlayers,
					server.backgroundImage
				);
				files.push(
					new Discord.AttachmentBuilder(server.playerListImage).setName("players.png")
				);
			} catch (error) {
				log.warn(error, "failed to render minecraft player list");
			}
		}

		const container = buildStatusContainer(
			server,
			server.lastStatus,
			count,
			files.length > 0,
			false
		);
		await server.postOrEditStatusMessage(
			[container],
			files,
			buildSignature(server.lastStatus, server.status.players, false)
		);
	}

	/** Repaints the status embed with a disconnected warning, keeping the last known data. */
	static async postDisconnected(server: MinecraftConnection): Promise<void> {
		if (!server.lastStatus || !server.discord.ready) return;

		const count = server.status.players.length;
		const files =
			count > 0 && server.playerListImage
				? [new Discord.AttachmentBuilder(server.playerListImage).setName("players.png")]
				: [];
		const container = buildStatusContainer(
			server,
			server.lastStatus,
			count,
			files.length > 0,
			true
		);
		await server.postOrEditStatusMessage(
			[container],
			files,
			buildSignature(server.lastStatus, server.status.players, true)
		);
	}
}
