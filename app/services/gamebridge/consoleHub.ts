import GameBridge from "./GameBridge.js";
import { WsGameConnection } from "./Payload.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

/** Games whose console rides their own game websocket rather than the host. */
export type ConsoleGame = "gmod" | "minecraft";

export type ConsoleSegment = { text: string; color?: string };
export type ConsoleLine = {
	level: string;
	text: string;
	color?: string;
	/** per-colour pieces, when one line was printed in several colours */
	parts?: ConsoleSegment[];
};
export type ConsoleEvent =
	{ type: "lines"; lines: ConsoleLine[]; replay: boolean } | { type: "meta"; text: string };
export type ConsoleListener = (event: ConsoleEvent) => void;

/** Lines kept per server, under the site's own 3000-line terminal buffer. */
const BACKLOG = 2000;

type ServerConsole = {
	/** FIFO of the most recent lines: oldest drop off as new ones arrive */
	backlog: ConsoleLine[];
	listeners: Set<ConsoleListener>;
};

/**
 * One console per game server, keyed "<game>:<id>" since ids are only unique
 * per game. A server streams from the moment it connects and never stops, so
 * the backlog is there whether or not anyone is watching and reopening the
 * site paints scrollback instead of an empty terminal. Lives outside the
 * connection objects, which are recreated on every reconnect.
 */
const consoles = new Map<string, ServerConsole>();

const key = (game: ConsoleGame, id: number) => `${game}:${id}`;

const consoleFor = (game: ConsoleGame, id: number): ServerConsole => {
	let state = consoles.get(key(game, id));
	if (!state) {
		state = { backlog: [], listeners: new Set() };
		consoles.set(key(game, id), state);
	}
	return state;
};

const live = (bridge: GameBridge, game: ConsoleGame, id: number): WsGameConnection | undefined => {
	const server = bridge.servers[game][id];
	return server?.wsConnection?.connected ? server : undefined;
};

/** Both games name their handler ConsolePayload; only the module path differs. */
async function sendAction(
	game: ConsoleGame,
	server: WsGameConnection,
	action: "subscribe" | "unsubscribe" | "command",
	command?: string,
	runner?: string
): Promise<void> {
	const { default: ConsolePayload } =
		game === "gmod"
			? await import("./games/gmod/handlers/ConsolePayload.js")
			: await import("./games/minecraft/handlers/ConsolePayload.js");
	await ConsolePayload.send(
		command === undefined ? { action } : { action, command, runner },
		server
	);
}

export const consoleHub = {
	/**
	 * Starts the stream for a freshly connected server. Called on every
	 * connection, so it doubles as the re-arm after a reconnect.
	 */
	start(game: ConsoleGame, server: WsGameConnection): void {
		consoleFor(game, server.config.id);
		sendAction(game, server, "subscribe").catch(err => log.warn(err));
	},

	/** Adds a viewer and hands back the backlog for it to paint first. */
	attach(game: ConsoleGame, id: number, listener: ConsoleListener): ConsoleLine[] {
		const state = consoleFor(game, id);
		state.listeners.add(listener);
		return state.backlog.slice();
	},

	/** Drops a viewer. The stream is independent of who is watching. */
	detach(game: ConsoleGame, id: number, listener: ConsoleListener): void {
		consoles.get(key(game, id))?.listeners.delete(listener);
	},

	/** Runs a command as the server console; output comes back through the log stream. */
	async command(
		bridge: GameBridge,
		game: ConsoleGame,
		id: number,
		command: string,
		runner: string
	): Promise<boolean> {
		const server = live(bridge, game, id);
		if (!server) return false;
		await sendAction(game, server, "command", command, runner);
		return true;
	},

	emit(game: ConsoleGame, id: number, event: ConsoleEvent): void {
		const state = consoleFor(game, id);
		if (event.type === "lines") {
			// the game keeps a replay ring of its own, which is only useful to
			// seed an empty backlog; past that it repeats what we already hold
			if (event.replay && state.backlog.length) return;
			state.backlog.push(...event.lines);
			if (state.backlog.length > BACKLOG) {
				state.backlog.splice(0, state.backlog.length - BACKLOG);
			}
		}
		for (const listener of state.listeners) {
			try {
				listener(event);
			} catch (err) {
				log.warn(err, "console listener failed");
			}
		}
	},
};
