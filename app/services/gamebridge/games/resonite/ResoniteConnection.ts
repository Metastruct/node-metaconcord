import * as Discord from "discord.js";
import { ResoniteSession } from "#/app/services/Resonite.js";
import GameConnection, { Player } from "../../GameConnection.js";

export const RESONITE_ACCENT = 4796260;

export type ResoniteSessionState = {
	session: ResoniteSession;
	backgroundImage: string;
	players: Player[];
	playerListImage?: Buffer;
	/** Fingerprint of the fields that affect players/playerListImage, so an unchanged heartbeat can skip re-rendering them. */
	contentKey: string;
};

export default class ResoniteConnection extends GameConnection {
	// keyed by sessionId - the host account can run several sessions at once,
	// each gets its own container + attachment in the single status message.
	sessions = new Map<string, ResoniteSessionState>();
	verifiedEmptySessions = new Set<string>();

	protected override buildEmptyStatusContainer(): Discord.ContainerBuilder {
		return new Discord.ContainerBuilder()
			.setAccentColor(RESONITE_ACCENT)
			.addTextDisplayComponents(text => text.setContent("### No instances online"))
			.addSeparatorComponents(sep => sep)
			.addTextDisplayComponents(text => text.setContent("-# metastruct @ Resonite"));
	}
}
