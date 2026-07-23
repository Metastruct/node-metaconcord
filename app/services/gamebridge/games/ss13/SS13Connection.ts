import GameConnection from "../../GameConnection.js";
import { WatchdogStatus } from "./tgsClient.js";

export type SS13Status = {
	watchdogStatus: WatchdogStatus;
	clientCount: number;
	launchTime?: string;
	port?: number;
	revision?: string;
};

export default class SS13Connection extends GameConnection {
	// kept so a failed poll can re-render the status embed without waiting for
	// a successful one that may never come.
	lastStatus?: SS13Status;
}
