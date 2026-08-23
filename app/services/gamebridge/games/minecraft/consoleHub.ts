import GameBridge from "../../GameBridge.js";
import MinecraftConnection from "./MinecraftConnection.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type ConsoleLine = { level: string; text: string };
export type ConsoleEvent =
	{ type: "lines"; lines: ConsoleLine[]; replay: boolean } | { type: "meta"; text: string };
export type ConsoleListener = (event: ConsoleEvent) => void;

/**
 * Fan-out of the mod's console stream to the website sessions watching it,
 * keyed by server id. Lives outside the connection objects because those are
 * recreated on every reconnect; the mod is told to stream only while there is
 * at least one listener, and is told again on every fresh connection.
 */
const listeners = new Map<number, Set<ConsoleListener>>();

const live = (bridge: GameBridge, id: number): MinecraftConnection | undefined => {
	const server = bridge.servers.minecraft[id];
	return server?.wsConnection?.connected ? server : undefined;
};

async function sendAction(
	server: MinecraftConnection,
	action: "subscribe" | "unsubscribe" | "command",
	command?: string
): Promise<void> {
	const { default: ConsolePayload } = await import("./handlers/ConsolePayload.js");
	await ConsolePayload.send(command === undefined ? { action } : { action, command }, server);
}

export const consoleHub = {
	hasListeners(id: number): boolean {
		return (listeners.get(id)?.size ?? 0) > 0;
	},

	subscribe(bridge: GameBridge, id: number, listener: ConsoleListener): void {
		let set = listeners.get(id);
		if (!set) {
			set = new Set();
			listeners.set(id, set);
		}
		const first = set.size === 0;
		set.add(listener);
		const server = live(bridge, id);
		if (first && server) sendAction(server, "subscribe").catch(err => log.warn(err));
	},

	unsubscribe(bridge: GameBridge, id: number, listener: ConsoleListener): void {
		const set = listeners.get(id);
		if (!set) return;
		set.delete(listener);
		if (set.size > 0) return;
		listeners.delete(id);
		const server = live(bridge, id);
		if (server) sendAction(server, "unsubscribe").catch(err => log.warn(err));
	},

	/** Runs a command as the server console; output comes back through the log stream. */
	async command(bridge: GameBridge, id: number, command: string): Promise<boolean> {
		const server = live(bridge, id);
		if (!server) return false;
		await sendAction(server, "command", command);
		return true;
	},

	/** Re-arms streaming on a fresh connection when sessions are still watching. */
	resubscribe(server: MinecraftConnection): void {
		if (!this.hasListeners(server.config.id)) return;
		sendAction(server, "subscribe").catch(err => log.warn(err));
	},

	emit(id: number, event: ConsoleEvent): void {
		const set = listeners.get(id);
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
