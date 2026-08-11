import ChatPayload from "./ChatPayload.js";
import JoinLeavePayload from "./JoinLeavePayload.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";

export { Payload, ChatPayload, JoinLeavePayload };

// The wire-protocol name (e.g. "ChatPayload") the mod sends is the handler
// class's own declared name, so no separate name mapping is needed.
const handlers: (typeof Payload)[] = [ChatPayload, JoinLeavePayload];

export function attachHandlers(connection: MinecraftConnection): void {
	for (const handler of handlers) {
		connection.on(handler.name, data => handler.handle(data, connection));
		handler.initialize(connection);
	}
}
