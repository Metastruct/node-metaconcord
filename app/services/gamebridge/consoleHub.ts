import GameBridge from "./GameBridge.js";
import { WsGameConnection } from "./Payload.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

/** Games whose console rides their own game websocket rather than the host. */
export type ConsoleGame = "gmod" | "minecraft";

export type ConsoleLine = { level: string; text: string; color?: string };
export type ConsoleEvent =
	{ type: "lines"; lines: ConsoleLine[]; replay: boolean } | { type: "meta"; text: string };
export type ConsoleListener = (event: ConsoleEvent) => void;

/**
 * Fan-out of a game's console stream to the website sessions watching it, keyed
 * by "<game>:<id>" since ids are only unique per game. Lives outside the
 * connection objects, which are recreated on every reconnect; the game is told
 * to stream only while there is at least one listener, and is told again on
 * every fresh connection.
 */
const listeners = new Map<string, Set<ConsoleListener>>();

const key = (game: ConsoleGame, id: number) => `${game}:${id}`;

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
	hasListeners(game: ConsoleGame, id: number): boolean {
		return (listeners.get(key(game, id))?.size ?? 0) > 0;
	},

	subscribe(bridge: GameBridge, game: ConsoleGame, id: number, listener: ConsoleListener): void {
		let set = listeners.get(key(game, id));
		if (!set) {
			set = new Set();
			listeners.set(key(game, id), set);
		}
		const first = set.size === 0;
		set.add(listener);
		const server = live(bridge, game, id);
		if (first && server) sendAction(game, server, "subscribe").catch(err => log.warn(err));
	},

	unsubscribe(
		bridge: GameBridge,
		game: ConsoleGame,
		id: number,
		listener: ConsoleListener
	): void {
		const set = listeners.get(key(game, id));
		if (!set) return;
		set.delete(listener);
		if (set.size > 0) return;
		listeners.delete(key(game, id));
		const server = live(bridge, game, id);
		if (server) sendAction(game, server, "unsubscribe").catch(err => log.warn(err));
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

	/** Re-arms streaming on a fresh connection when sessions are still watching. */
	resubscribe(game: ConsoleGame, server: WsGameConnection): void {
		if (!this.hasListeners(game, server.config.id)) return;
		sendAction(game, server, "subscribe").catch(err => log.warn(err));
	},

	emit(game: ConsoleGame, id: number, event: ConsoleEvent): void {
		const set = listeners.get(key(game, id));
		if (!set) return;
		for (const listener of set) {
			try {
				listener(event);
			} catch (err) {
				log.warn(err, "console listener failed");
			}
		}
	},
};
