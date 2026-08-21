import AdvancementPayload from "./AdvancementPayload.js";
import ChatPayload from "./ChatPayload.js";
import DeathPayload from "./DeathPayload.js";
import JoinLeavePayload from "./JoinLeavePayload.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import StatusPayload from "./StatusPayload.js";

export { Payload, AdvancementPayload, ChatPayload, DeathPayload, JoinLeavePayload, StatusPayload };

// The wire-protocol name (e.g. "ChatPayload") the mod sends is the handler
// class's own declared name, so no separate name mapping is needed.
const handlers: (typeof Payload)[] = [
	AdvancementPayload,
	ChatPayload,
	DeathPayload,
	JoinLeavePayload,
	StatusPayload,
];

export function attachHandlers(connection: MinecraftConnection): void {
	for (const handler of handlers) {
		connection.on(handler.name, data => handler.handle(data, connection));
		handler.initialize(connection);
	}
}
