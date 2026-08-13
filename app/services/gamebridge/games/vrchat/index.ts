import * as Discord from "discord.js";
import { VRChat } from "vrchat";
import type { Group, GroupInstance } from "vrchat";
import GameBridge from "../../GameBridge.js";
import { Player } from "../../GameConnection.js";
import { renderPlayerListImage } from "../../renderPlayerList.js";
import VRChatConnection from "./VRChatConnection.js";
import config from "@/config/vrchat.json" with { type: "json" };
import pkg from "@/package.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

const VRCHAT_SERVER_ID = 1;
const POLL_INTERVAL_MS = 150_000;

function launchUrl(worldId: string, instanceId: string): string {
	return `https://vrchat.com/home/launch?worldId=${worldId}&instanceId=${instanceId}`;
}

function buildStatusContainer(
	group: Group | undefined,
	instances: GroupInstance[],
	hasPlayerListImage: boolean,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();
	container.setAccentColor(0x1778e9);

	const totalPlayers = instances.reduce((sum, i) => sum + i.memberCount, 0);

	let desc = `### ${group?.name ?? "VRChat"}`;
	desc += `\n:busts_in_silhouette: Player${totalPlayers === 1 ? "" : "s"}: **${totalPlayers}**`;
	desc += `\n:map: Instance${instances.length === 1 ? "" : "s"}: **${instances.length}**`;

	if (instances.length > 0) {
		desc +=
			"\n" +
			instances
				.map(
					i =>
						`• [${i.world.name}](${launchUrl(i.world.id, i.instanceId)}): **${i.memberCount}** player${i.memberCount === 1 ? "" : "s"}`
				)
				.join("\n");
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
	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ VRChat"));

	return container;
}

export function attachVRChat(bridge: GameBridge): void {
	const vrchat = new VRChat({
		application: {
			name: pkg.name,
			version: pkg.version,
			contact: "https://metastruct.net",
		},
		authentication: {
			credentials: {
				username: config.username,
				password: config.password,
				totpSecret: config.totpSecret,
			},
		},
	});

	const connection = (bridge.servers.vrchat[VRCHAT_SERVER_ID] = new VRChatConnection({
		bridge,
		serverConfig: {
			name: "#vrchat 🇪🇺",
			id: VRCHAT_SERVER_ID,
			discordToken: config.discordToken,
		},
	}));

	vrchat
		.getGroup({ path: { groupId: config.groupId } })
		.then(({ data }) => (connection.group = data))
		.catch(err => log.warn(err, "VRChat group lookup failed"));

	const poll = async () => {
		try {
			const { data: instances } = await vrchat.getGroupInstances({
				path: { groupId: config.groupId },
				throwOnError: true,
			});

			// Instance-level member counts are all the group-instances endpoint
			// exposes - VRChat only returns a per-instance `users` roster for
			// instances the requesting account itself created, so there's no way
			// to list real players here. The "playerlist" image instead shows one
			// row per instance (world + population).
			const players: Player[] = instances.map(i => ({
				nick: i.world.name,
				avatar: i.world.thumbnailImageUrl || i.world.imageUrl,
				description: `${i.memberCount} player${i.memberCount === 1 ? "" : "s"}`,
				steamId64: "",
				isAdmin: false,
				isBanned: false,
				ip: "",
			}));

			const files: Discord.AttachmentBuilder[] = [];
			if (players.length > 0) {
				connection.playerListImage = await renderPlayerListImage(players);
				files.push(
					new Discord.AttachmentBuilder(connection.playerListImage).setName("players.png")
				);
			}

			connection.lastInstances = instances;
			connection.disconnected = false;

			const totalPlayers = instances.reduce((sum, i) => sum + i.memberCount, 0);
			if (totalPlayers > 0) {
				connection.setPresence("online", {
					activity: {
						name: `${totalPlayers} player${totalPlayers === 1 ? "" : "s"} in ${instances.sort(i => i.memberCount)[0].world.name}`,
						type: Discord.ActivityType.Watching,
					},
				});
			} else {
				connection.setPresence("idle", { afk: true });
			}

			const container = buildStatusContainer(
				connection.group,
				instances,
				files.length > 0,
				false
			);
			await connection.postOrEditStatusMessage(container, files);
		} catch (err) {
			log.error(err, "VRChat poll failed");
			connection.disconnected = true;
			connection.setPresence("idle", { afk: true });

			if (connection.lastInstances) {
				try {
					const files =
						connection.lastInstances.length > 0
							? [
									new Discord.AttachmentBuilder(
										connection.playerListImage
									).setName("players.png"),
								]
							: [];
					const container = buildStatusContainer(
						connection.group,
						connection.lastInstances,
						files.length > 0,
						true
					);
					await connection.postOrEditStatusMessage(container, files);
				} catch (postErr) {
					log.error(postErr, "failed to post VRChat disconnect status");
				}
			}
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);
}
