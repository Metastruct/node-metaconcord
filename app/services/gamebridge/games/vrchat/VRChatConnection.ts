import GameConnection from "../../GameConnection.js";
import type { Group, GroupInstance } from "vrchat";

export default class VRChatConnection extends GameConnection {
	group?: Group;
	// kept so a failed poll can re-render the status embed without waiting for
	// a successful one that may never come.
	lastInstances?: GroupInstance[];
}
