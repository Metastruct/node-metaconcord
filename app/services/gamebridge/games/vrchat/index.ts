import * as Discord from "discord.js";
import { VRChat } from "vrchat";
import type { Group, GroupInstance } from "vrchat";
import GameBridge from "../../GameBridge.js";
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

function buildHeaderContainer(
	group: Group | undefined,
	totalPlayers: number,
	instanceCount: number,
	disconnected: boolean
): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();
	container.setAccentColor(0x1778e9);

	let desc = `### ${group?.name ?? "VRChat"}`;
	desc += `\n:busts_in_silhouette: Player${totalPlayers === 1 ? "" : "s"}: **${totalPlayers}**`;
	desc += `\n:map: Instance${instanceCount === 1 ? "" : "s"}: **${instanceCount}**`;

	if (disconnected) {
		desc = `⚠️ **Server disconnected** info may be outdated\n${desc}`;
	}

	container.addTextDisplayComponents(text => text.setContent(desc));
	container.addSeparatorComponents(sep => sep);
	container.addTextDisplayComponents(text => text.setContent("-# metastruct @ VRChat"));

	return container;
}

// The group-instances endpoint only exposes a per-instance member count, not
// a real player roster (VRChat only returns that for instances the
// requesting account itself created) - so each instance gets a status card
// keyed on world info rather than a player list.
function buildInstanceContainer(instance: GroupInstance): Discord.ContainerBuilder {
	const container = new Discord.ContainerBuilder();
	container.setAccentColor(0x1778e9);

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

function buildContainers(
	group: Group | undefined,
	instances: GroupInstance[],
	disconnected: boolean
): Discord.ContainerBuilder[] {
	const totalPlayers = instances.reduce((sum, i) => sum + i.memberCount, 0);
	return [
		buildHeaderContainer(group, totalPlayers, instances.length, disconnected),
		...instances.map(buildInstanceContainer),
	];
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

			const containers = buildContainers(connection.group, instances, false);
			await connection.postOrEditStatusMessage(containers, []);
		} catch (err) {
			log.error(err, "VRChat poll failed");
			connection.disconnected = true;
			connection.setPresence("idle", { afk: true });

			if (connection.lastInstances) {
				try {
					const containers = buildContainers(
						connection.group,
						connection.lastInstances,
						true
					);
					await connection.postOrEditStatusMessage(containers, []);
				} catch (postErr) {
					log.error(postErr, "failed to post VRChat disconnect status");
				}
			}
		}
	};

	poll();
	setInterval(poll, POLL_INTERVAL_MS);
}
