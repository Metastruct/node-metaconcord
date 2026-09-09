import { ConsoleRequest } from "./structures/index.js";
import GmodConnection from "../GmodConnection.js";
import Payload from "./Payload.js";
import { consoleHub } from "../../../consoleHub.js";
import requestSchema from "./structures/ConsoleRequest.json" with { type: "json" };
import responseSchema from "./structures/ConsoleResponse.json" with { type: "json" };

/**
 * The addon's console stream for the website's rocket page, and the
 * subscribe/unsubscribe/command control messages going the other way. The
 * lines come from gm_enginespew, so they carry a level and the spew colour.
 */
export default class ConsolePayload extends Payload {
	protected static requestSchema = requestSchema;
	protected static responseSchema = responseSchema;

	static async initialize(server: GmodConnection): Promise<void> {
		consoleHub.start("gmod", server);
		server.wsConnection?.on("close", () =>
			consoleHub.emit("gmod", server.config.id, { type: "meta", text: "server disconnected" })
		);
	}

	static async handle(payload: ConsoleRequest, server: GmodConnection): Promise<void> {
		super.handle(payload, server);
		const { lines, replay } = payload.data;
		consoleHub.emit("gmod", server.config.id, { type: "lines", lines, replay: !!replay });
	}
}
