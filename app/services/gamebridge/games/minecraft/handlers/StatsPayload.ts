import { StatsRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import requestSchema from "./structures/StatsRequest.json" with { type: "json" };

export default class StatsPayload extends Payload {
	protected static requestSchema = requestSchema;

	static async handle(payload: StatsRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);

		const { cpu, memUsed, memMax, netRx, netTx, tps, mspt, players } = payload.data;
		server.lastMspt = mspt;
		server.bridge.statsFor("minecraft", server.config.id).push({
			t: Date.now(),
			cpu,
			memUsed,
			memMax,
			netRx,
			netTx,
			tick: tps,
			players,
		});
	}
}
