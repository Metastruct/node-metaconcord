import * as Discord from "discord.js";
import GameConnection, { Player } from "../../GameConnection.js";
import type { Group, GroupInstance } from "vrchat";
import config from "#/config/vrchat.json" with { type: "json" };

export const VRCHAT_ACCENT = 0x17_78_E9;

export type VRChatRoster = {
	/** The bot's friends currently in this instance. */
	players: Player[];
	playerListImage?: Buffer;
	/** Fingerprint of the players that feed the image, so an unchanged roster skips re-rendering. */
	contentKey: string;
};

export default class VRChatConnection extends GameConnection {
	group?: Group;
	/** Most recent successful poll - also read by the website's /servers API. */
	lastInstances?: GroupInstance[];
	/**
	 * The bot's friends per instance location. VRChat only exposes a member count
	 * for group instances, so the only roster we can show is the friends whose
	 * location matches the instance. Also read by the website's /servers API.
	 */
	rosters = new Map<string, VRChatRoster>();

	protected override buildEmptyStatusContainer(): Discord.ContainerBuilder {
		return new Discord.ContainerBuilder()
			.setAccentColor(VRCHAT_ACCENT)
			.addTextDisplayComponents(text => text.setContent("### No active group instances\nfeel free to create one!"))
			.addSeparatorComponents(sep => sep)
			.addActionRowComponents(row =>
				row.setComponents(
					new Discord.ButtonBuilder()
						.setStyle(Discord.ButtonStyle.Link)
						.setLabel("VRC Group")
						.setURL("https://vrchat.com/home/group/" + config.groupId)
				)
			)
			.addSeparatorComponents(sep => sep)
			.addTextDisplayComponents(text => text.setContent("-# metastruct @ VRChat"));
	}
}
