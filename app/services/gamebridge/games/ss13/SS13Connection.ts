import GameConnection from "../../GameConnection.js";
import { WatchdogStatus } from "./tgsClient.js";
import { TopicStatus } from "./topics.js";

export type SS13Status = TopicStatus & {
	watchdogStatus: WatchdogStatus;
	clientCount: number;
	launchTime?: string;
	port?: number;
	/** TGS compile-job commit sha - see TopicStatus.gameCommit for the live build's own idea of its commit. */
	revision?: string;
};

export default class SS13Connection extends GameConnection {
	// kept so a failed poll can re-render the status embed without waiting for
	// a successful one that may never come.
	lastStatus?: SS13Status;
}
