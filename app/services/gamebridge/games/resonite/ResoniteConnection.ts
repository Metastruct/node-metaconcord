import { ResoniteSession } from "@/app/services/Resonite.js";
import GameConnection from "../../GameConnection.js";

export default class ResoniteConnection extends GameConnection {
	// kept so a disconnect can re-render the status embed without waiting for
	// a fresh ReceiveSessionUpdate that will never come.
	lastSession?: ResoniteSession;
}
