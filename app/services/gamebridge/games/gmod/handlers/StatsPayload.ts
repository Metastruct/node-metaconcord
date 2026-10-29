import type GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import { type StatsRequest } from "./structures/index.js";
import requestSchema from "./structures/StatsRequest.json" with { type: "json" };

/**
 * Pushed by the addon every 5s. Replaces the ssh probe that used to sample
 * /proc on the host, so a server the bridge cannot reach simply stops
 * reporting instead of filling the log with ssh timeouts.
 */
export default class StatsPayload extends Payload {
	protected static override requestSchema = requestSchema;

	static override async handle(payload: StatsRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);

		const { cpu, memUsed, memMax, netRx, netTx, fps, players, maxPlayers } = payload.data;
		server.maxPlayers = maxPlayers;
		server.bridge.statsFor("gmod", server.config.id).push({
			t: Date.now(),
			cpu,
			memUsed,
			memMax,
			netRx,
			netTx,
			tick: fps,
			players,
		});
	}
}
