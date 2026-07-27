import { queryTopic } from "./byondTopic.js";

// DM has no real boolean type - TRUE/FALSE are just #defined to 1/0, and
// json_encode() doesn't special-case them into JSON true/false. These fields
// arrive as the number 0 or 1, not a JSON boolean.
type DmBool = 0 | 1;

// Mirrors GAME_STATE_* in code/__DEFINES/subsystems.dm.
export enum GameState {
	Startup = 0,
	Pregame = 1,
	SettingUp = 2,
	Playing = 3,
	Finished = 4,
}

export type TopicStatus = {
	version?: string;
	respawn?: DmBool;
	enter?: DmBool;
	ai?: DmBool;
	host?: string | null;
	roundId?: number;
	players?: number;
	/** Git commit sha embedded in the running build (GLOB.revdata.commit) - distinct from the TGS compile-job sha already on SS13Status.revision, though they should normally agree. */
	gameCommit?: string;
	gameCommitDate?: string;
	hub?: DmBool;
	identifier?: string;
	publicAddress?: string;
	admins?: number;
	gamestate?: GameState;
	mapName?: string;
	/** Only present when a valid comms key was sent with the query. */
	activePlayers?: number;
	securityLevel?: string;
	roundDuration?: number;
	timeDilationCurrent?: number;
	timeDilationAvg?: number;
	timeDilationAvgSlow?: number;
	timeDilationAvgFast?: number;
	softPopcap?: number;
	hardPopcap?: number;
	extremePopcap?: number;
	popcap?: number;
	bunkered?: DmBool;
	interviews?: DmBool;
	shuttleMode?: string;
	shuttleTimer?: number;
};

export type TopicPlayer = {
	name: string;
	job?: string;
	headshot?: string;
};

function asString(v: unknown): string | undefined {
	return typeof v === "string" ? v : undefined;
}

function asNumber(v: unknown): number | undefined {
	return typeof v === "number" ? v : undefined;
}

function asDmBool(v: unknown): DmBool | undefined {
	return v === 0 || v === 1 ? v : undefined;
}

function asGameState(v: unknown): GameState | undefined {
	return typeof v === "number" && v in GameState ? (v as GameState) : undefined;
}

export async function getServerStatus(
	host: string,
	port: number,
	commsKey?: string
): Promise<TopicStatus> {
	// require_comms_key is FALSE for this topic, so it always answers - a
	// missing/wrong key just means "active_players" is left out of the reply.
	const query = commsKey
		? `status&format=json&key=${encodeURIComponent(commsKey)}`
		: "status&format=json";
	const raw = await queryTopic(host, port, query);
	const data = JSON.parse(raw) as Record<string, unknown>;

	return {
		version: asString(data.version),
		respawn: asDmBool(data.respawn),
		enter: asDmBool(data.enter),
		ai: asDmBool(data.ai),
		host: asString(data.host) ?? null,
		roundId: asNumber(data.round_id),
		players: asNumber(data.players),
		gameCommit: asString(data.revision),
		gameCommitDate: asString(data.revision_date),
		hub: asDmBool(data.hub),
		identifier: asString(data.identifier),
		publicAddress: asString(data.public_address),
		admins: asNumber(data.admins),
		gamestate: asGameState(data.gamestate),
		mapName: asString(data.map_name),
		activePlayers: asNumber(data.active_players),
		securityLevel: asString(data.security_level),
		roundDuration: asNumber(data.round_duration),
		timeDilationCurrent: asNumber(data.time_dilation_current),
		timeDilationAvg: asNumber(data.time_dilation_avg),
		timeDilationAvgSlow: asNumber(data.time_dilation_avg_slow),
		timeDilationAvgFast: asNumber(data.time_dilation_avg_fast),
		softPopcap: asNumber(data.soft_popcap),
		hardPopcap: asNumber(data.hard_popcap),
		extremePopcap: asNumber(data.extreme_popcap),
		popcap: asNumber(data.popcap),
		bunkered: asDmBool(data.bunkered),
		interviews: asDmBool(data.interviews),
		shuttleMode: asString(data.shuttle_mode),
		shuttleTimer: asNumber(data.shuttle_timer),
	};
}

export async function getPlayerList(
	host: string,
	port: number,
	commsKey: string
): Promise<TopicPlayer[]> {
	const raw = await queryTopic(
		host,
		port,
		`playerlist&format=json&key=${encodeURIComponent(commsKey)}`
	);
	const data = JSON.parse(raw) as unknown;
	if (!Array.isArray(data)) {
		throw new Error(`playerlist topic returned an error: ${raw}`);
	}
	return (data as Record<string, unknown>[]).map(entry => ({
		name: typeof entry.name === "string" ? entry.name : "Unknown",
		job: typeof entry.job === "string" ? entry.job : undefined,
		headshot: typeof entry.headshot === "string" ? entry.headshot : undefined,
	}));
}
