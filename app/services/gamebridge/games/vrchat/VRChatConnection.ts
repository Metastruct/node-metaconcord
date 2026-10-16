import * as Discord from "discord.js";
import GameConnection from "../../GameConnection.js";
import type { Group, GroupInstance } from "vrchat";

export const VRCHAT_ACCENT = 0x1778e9;

export default class VRChatConnection extends GameConnection {
	group?: Group;
	/** Most recent successful poll - also read by the website's /servers API. */
	lastInstances?: GroupInstance[];

	protected override buildEmptyStatusContainer(): Discord.ContainerBuilder {
		return new Discord.ContainerBuilder()
			.setAccentColor(VRCHAT_ACCENT)
			.addTextDisplayComponents(text => text.setContent("### No instances online"));
	}
}
