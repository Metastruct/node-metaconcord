import * as Discord from "discord.js";
import { StatusRequest } from "./structures/index.js";
import MinecraftConnection, { MinecraftStatus } from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import { renderPlayerListImage } from "../../../renderPlayerList.js";
import requestSchema from "./structures/StatusRequest.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

function buildStatusContainer(
	server: MinecraftConnection,
	status: MinecraftStatus,
	playerCount: number,
	hasPlayerListImage: boolean,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();

	container.setAccentColor(disconnected ? 0xb54343 : 0x4bb543);

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
	protected static requestSchema = requestSchema;

	static async handle(payload: StatusRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { hostname, version, maxPlayers, uptime, players } = payload.data;
		const { discord } = server;

		if (!discord.ready) return;

		server.status.players = players.map(player => ({
			nick: player.nick,
			steamId64: player.uuid,
			avatar: `https://mc-heads.net/avatar/${player.uuid}`,
			ip: "",
			isAdmin: false,
			isBanned: false,
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
			upSince: ((Date.now() / 1000) | 0) - uptime,
		};

		const files: Discord.AttachmentBuilder[] = [];
		if (count > 0) {
			try {
				server.playerListImage = await renderPlayerListImage(server.status.players);
				files.push(
					new Discord.AttachmentBuilder(server.playerListImage).setName("players.png")
				);
			} catch (err) {
				log.warn(err, "failed to render minecraft player list");
			}
		}

		const container = buildStatusContainer(
			server,
			server.lastStatus,
			count,
			files.length > 0,
			false
		);
		await server.postOrEditStatusMessage(container, files);
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
		await server.postOrEditStatusMessage(container, files);
	}
}
