import type MinecraftConnection from "../MinecraftConnection.ts";
import AddonsPayload from "./AddonsPayload.ts";
import AdvancementPayload from "./AdvancementPayload.ts";
import ChatPayload from "./ChatPayload.ts";
import ConsolePayload from "./ConsolePayload.ts";
import DeathPayload from "./DeathPayload.ts";
import JoinLeavePayload from "./JoinLeavePayload.ts";
import type Payload from "./Payload.ts";
import StatsPayload from "./StatsPayload.ts";
import StatusPayload from "./StatusPayload.ts";



// The wire-protocol name (e.g. "ChatPayload") the mod sends is the handler
// class's own declared name, so no separate name mapping is needed.
const handlers: (typeof Payload)[] = [
	AddonsPayload,
	AdvancementPayload,
	ChatPayload,
	ConsolePayload,
	DeathPayload,
	JoinLeavePayload,
	StatsPayload,
	StatusPayload,
];

export function attachHandlers(connection: MinecraftConnection): void {
	for (const handler of handlers) {
		connection.on(handler.name, data => handler.handle(data, connection));
		handler.initialize(connection);
	}
}

export { default as AddonsPayload } from "./AddonsPayload.ts";
export { default as AdvancementPayload } from "./AdvancementPayload.ts";
export { default as ChatPayload } from "./ChatPayload.ts";
export { default as ConsolePayload } from "./ConsolePayload.ts";
export { default as DeathPayload } from "./DeathPayload.ts";
export { default as JoinLeavePayload } from "./JoinLeavePayload.ts";
export { default as Payload } from "./Payload.ts";
export { default as StatsPayload } from "./StatsPayload.ts";
export { default as StatusPayload } from "./StatusPayload.ts";

