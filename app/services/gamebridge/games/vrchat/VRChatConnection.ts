import * as Discord from "discord.js";
import GameConnection from "../../GameConnection.js";
import type { Group, GroupInstance } from "vrchat";
import config from "#/config/vrchat.json" with { type: "json" };

export const VRCHAT_ACCENT = 0x17_78_e9;

export default class VRChatConnection extends GameConnection {
	group?: Group;
	/** Most recent successful poll - also read by the website's /servers API. */
	lastInstances?: GroupInstance[];

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
