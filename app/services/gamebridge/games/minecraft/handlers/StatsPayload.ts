import type MinecraftConnection from "../MinecraftConnection.ts";
import Payload from "./Payload.ts";
import type { StatsRequest } from "./structures/index.ts";
import requestSchema from "./structures/StatsRequest.json" with { type: "json" };

export default class StatsPayload extends Payload {
	protected static override requestSchema = requestSchema;

	static override async handle(payload: StatsRequest, server: MinecraftConnection): Promise<void> {
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
