import { ConsoleRequest } from "./structures/index.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import { consoleHub } from "../consoleHub.js";
import requestSchema from "./structures/ConsoleRequest.json" with { type: "json" };
import responseSchema from "./structures/ConsoleResponse.json" with { type: "json" };

/**
 * The mod's console stream (server log lines) for the website's rocket page,
 * and the subscribe/unsubscribe/command control messages going the other way.
 */
export default class ConsolePayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async initialize(server: MinecraftConnection): Promise<void> {
		consoleHub.resubscribe(server);
		server.wsConnection?.on("close", () =>
			consoleHub.emit(server.config.id, { type: "meta", text: "server disconnected" })
		);
	}

	static async handle(payload: ConsoleRequest, server: MinecraftConnection): Promise<void> {
		super.handle(payload, server);
		const { lines, replay } = payload.data;
		consoleHub.emit(server.config.id, { type: "lines", lines, replay: !!replay });
	}
}
