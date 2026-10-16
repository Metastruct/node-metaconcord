import * as Discord from "discord.js";
import GameConnection, { Player } from "../../GameConnection.js";
import { WatchdogStatus } from "./tgsClient.js";
import { TopicStatus } from "./topics.js";

export const SS13_ACCENT = 0x4bb543;

export type SS13Status = TopicStatus & {
	watchdogStatus: WatchdogStatus;
	clientCount: number;
	launchTime?: string;
	port?: number;
	/** TGS compile-job commit sha - see TopicStatus.gameCommit for the live build's own idea of its commit. */
	revision?: string;
};

export type SS13InstanceState = {
	/** TGS instance name, used as the display label instead of anything we'd have to configure ourselves. */
	name: string;
	status: SS13Status;
	players: Player[];
	playerListImage?: Buffer;
};

export default class SS13Connection extends GameConnection {
	// keyed by TGS instanceId - a single bot identity reports on every
	// configured instance that's currently online, one container each.
	instances = new Map<number, SS13InstanceState>();

	protected override buildEmptyStatusContainer(): Discord.ContainerBuilder {
		return new Discord.ContainerBuilder()
			.setAccentColor(SS13_ACCENT)
			.addTextDisplayComponents(text => text.setContent("### No instances online"));
	}
}
