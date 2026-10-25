import * as Discord from "discord.js";
import { VRChat } from "vrchat";
import type { Group, GroupInstance, LimitedUserFriend } from "vrchat";
import GameBridge from "../../GameBridge.js";
import { Player } from "../../GameConnection.js";
import VRChatConnection, { VRCHAT_ACCENT, VRChatRoster } from "./VRChatConnection.js";
import { renderPlayerListImage } from "../../renderPlayerList.js";
import config from "#/config/vrchat.json" with { type: "json" };
import pkg from "#/package.json" with { type: "json" };
import { localeCompare, logger } from "#/utils.js";

const log = logger(import.meta);

const VRCHAT_SERVER_ID = 1;
const POLL_INTERVAL_MS = 150_000;

function launchUrl(worldId: string, instanceId: string): string {
	return `https://vrchat.com/home/launch?worldId=${worldId}&instanceId=${instanceId}`;
}

// instanceId contains characters (`:`, `~`, `(`, `)`) that break `attachment://`
// URL parsing, so strip them down to a filename-safe form.
function attachmentName(instanceId: string): string {
	return `players-${instanceId.replaceAll(/[^a-zA-Z0-9_-]/g, "_")}.png`;
}

function friendToPlayer(friend: LimitedUserFriend): Player {
	return {
		nick: friend.displayName,
		// VRChat's avatar image URLs are served without an auth cookie.
		avatar: friend.currentAvatarImageUrl || friend.iconUrl || undefined,
		// reused as the generic platform id (and the avatar cache key), like
		// Minecraft does with its UUID.
		steamId64: friend.id,
		ip: "",
		isAdmin: false,
		isBanned: false,
	};
}

function buildHeaderContainer(
	group: Group | undefined,
	totalPlayers: number,
	instanceCount: number
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();
	container.setAccentColor(VRCHAT_ACCENT);

	let desc = `### ${group?.name ?? "VRChat"}`;
	desc += `\n:busts_in_silhouette: Player${totalPlayers === 1 ? "" : "s"}: **${totalPlayers}**`;
	desc += `\n:map: Instance${instanceCount === 1 ? "" : "s"}: **${instanceCount}**`;

	container.addTextDisplayComponents(text => text.setContent(desc));
	container.addSeparatorComponents(sep => sep);
	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ VRChat"));

	return container;
}

// The group-instances endpoint only exposes a per-instance member count, not a
// full roster (VRChat only returns that for instances the requesting account
// itself created) - so an instance's card shows the member count plus a player
// list image of whichever of the bot's friends are in it.
function buildInstanceContainer(
	instance: GroupInstance,
	attachment?: string
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();
	container.setAccentColor(VRCHAT_ACCENT);

	const capacity = instance.world.capacity;
	const desc =
		`### ${instance.world.name}\n` +
		`:busts_in_silhouette: Players: **${instance.memberCount}${capacity ? `/${capacity}` : ""}**`;

	container.addSectionComponents(section =>
		section
			.addTextDisplayComponents(text => text.setContent(desc))
			.setThumbnailAccessory(accessory =>
				accessory
					.setURL(instance.world.thumbnailImageUrl || instance.world.imageUrl)
					.setDescription(instance.world.name)
			)
	);

	if (attachment) {
		container.addSeparatorComponents(sep => sep);
		container.addMediaGalleryComponents(gallery =>
			gallery.addItems(item => item.setURL(`attachment://${attachment}`))
		);
	}

	container.addSeparatorComponents(sep => sep);

	container.addActionRowComponents(row =>
		row.setComponents(
			new Discord.ButtonBuilder()
				.setStyle(Discord.ButtonStyle.Link)
				.setLabel("Join")
				.setURL(launchUrl(instance.world.id, instance.instanceId))
		)
	);

	return container;
}

/**
 * Fingerprint of only the state that should trigger a Discord edit - so a poll
 * with nothing new to report doesn't repost the message.
 */
function buildSignature(
	instances: GroupInstance[],
	rosters: Map<string, VRChatRoster>,
	disconnected: boolean
): unknown {
	return {
		disconnected,
		instances: instances
			.map(i => ({
				id: i.instanceId,
				world: i.world.id,
				count: i.memberCount,
				friends: (rosters.get(i.location)?.players ?? [])
					.map(p => p.steamId64)
					.toSorted(localeCompare),
			}))
			.toSorted((a, b) => a.id.localeCompare(b.id)),
	};
}

function buildContainers(
	group: Group | undefined,
	instances: GroupInstance[],
	rosters: Map<string, VRChatRoster>
): { containers: Discord.ContainerBuilder[]; files: Discord.AttachmentBuilder[] } {
	// nothing to report -> let the connection's empty-state card handle it
	if (instances.length === 0) return { containers: [], files: [] };

	const totalPlayers = instances.reduce((sum, i) => sum + i.memberCount, 0);
	const containers = [buildHeaderContainer(group, totalPlayers, instances.length)];
	const files: Discord.AttachmentBuilder[] = [];

	for (const instance of instances) {
		const image = rosters.get(instance.location)?.playerListImage;
		if (image) {
			const name = attachmentName(instance.instanceId);
			containers.push(buildInstanceContainer(instance, name));
			files.push(new Discord.AttachmentBuilder(image).setName(name));
		} else {
			containers.push(buildInstanceContainer(instance));
		}
	}

	return { containers, files };
}

/**
 * Refreshes the tracked rosters for the given instances, re-rendering a player
 * list image only when that instance's friends actually changed.
 */
async function updateRosters(
	connection: VRChatConnection,
	instances: GroupInstance[],
	friendsByLocation: Map<string, LimitedUserFriend[]>
): Promise<void> {
	const liveLocations = new Set(instances.map(i => i.location));
	for (const location of connection.rosters.keys()) {
		if (!liveLocations.has(location)) connection.rosters.delete(location);
	}

	for (const instance of instances) {
		const players = (friendsByLocation.get(instance.location) ?? [])
			.map(friendToPlayer)
			.toSorted((a, b) => a.nick.localeCompare(b.nick));
		const contentKey = JSON.stringify(
			players.map(p => `${p.steamId64}:${p.avatar ?? ""}`).toSorted(localeCompare)
		);

		const prior = connection.rosters.get(instance.location);
		// keep the last render while the roster is unchanged; an image left
		// undefined by a failed render is retried on the next poll.
		let playerListImage =
			prior?.contentKey === contentKey ? prior.playerListImage : undefined;

		if (players.length === 0) {
			playerListImage = undefined;
		} else if (!playerListImage) {
			try {
				playerListImage = await renderPlayerListImage(
					players,
					instance.world.thumbnailImageUrl || instance.world.imageUrl || undefined
				);
			} catch (error) {
				log.warn(error, "failed to render VRChat player list");
			}
		}

		connection.rosters.set(instance.location, { players, playerListImage, contentKey });
	}
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
		.catch(error => log.warn(error, "VRChat group lookup failed"));

	const poll = async () => {
		try {
			const { data: instances } = await vrchat.getGroupInstances({
				path: { groupId: config.groupId },
				throwOnError: true,
			});

			connection.lastInstances = instances;
			connection.disconnected = false;

			// A failed friends lookup keeps the last known rosters rather than
			// blanking every instance's player list over a transient API error.
			let friends: LimitedUserFriend[] | undefined;
			try {
				friends = (
					await vrchat.getFriends({ query: { offline: false }, throwOnError: true })
				).data;
			} catch (error) {
				log.warn(error, "VRChat friends lookup failed");
			}

			if (friends) {
				const friendsByLocation = new Map<string, LimitedUserFriend[]>();
				for (const friend of friends) {
					if (!friend.location) continue;
					const list = friendsByLocation.get(friend.location);
					if (list) list.push(friend);
					else friendsByLocation.set(friend.location, [friend]);
				}

				await updateRosters(connection, instances, friendsByLocation);
			}

			const totalPlayers = instances.reduce((sum, i) => sum + i.memberCount, 0);
			if (totalPlayers > 0) {
				connection.setPresence("online", {
					activity: {
						name: `${totalPlayers} player${totalPlayers === 1 ? "" : "s"} in ${instances.toSorted(i => i.memberCount)[0].world.name}`,
						type: Discord.ActivityType.Watching,
					},
				});
			} else {
				connection.setPresence("idle", { afk: true });
			}

			const { containers, files } = buildContainers(
				connection.group,
				instances,
				connection.rosters
			);
			await connection.postOrEditStatusMessage(
				containers,
				files,
				buildSignature(instances, connection.rosters, false)
			);
		} catch (error) {
			log.error(error, "VRChat poll failed");
			connection.disconnected = true;
			connection.setPresence("idle", { afk: true });

			try {
				await connection.postOrEditStatusMessage(
					[],
					[],
					buildSignature([], connection.rosters, true)
				);
			} catch (error) {
				log.error(error, "failed to post VRChat disconnect status");
			}
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);
}
