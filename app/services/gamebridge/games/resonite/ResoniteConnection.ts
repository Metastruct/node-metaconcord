import { ResoniteSession } from "@/app/services/Resonite.js";
import GameConnection, { Player } from "../../GameConnection.js";

export type ResoniteSessionState = {
	session: ResoniteSession;
	mapThumbnail: string;
	players: Player[];
	playerListImage?: Buffer;
	lastCount: number;
	lastSessionBeginTime: number;
	lastPresence: string;
};

export default class ResoniteConnection extends GameConnection {
	// keyed by sessionId - the host account can run several sessions at once,
	// each gets its own container + attachment in the single status message.
	sessions = new Map<string, ResoniteSessionState>();
}
