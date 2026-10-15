import AddonsPayload from "./AddonsPayload.js";
import AdvancementPayload from "./AdvancementPayload.js";
import ChatPayload from "./ChatPayload.js";
import ConsolePayload from "./ConsolePayload.js";
import DeathPayload from "./DeathPayload.js";
import JoinLeavePayload from "./JoinLeavePayload.js";
import MinecraftConnection from "../MinecraftConnection.js";
import Payload from "./Payload.js";
import StatsPayload from "./StatsPayload.js";
import StatusPayload from "./StatusPayload.js";



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

export {default as Payload} from "./Payload.js";
export {default as AddonsPayload} from "./AddonsPayload.js";
export {default as AdvancementPayload} from "./AdvancementPayload.js";
export {default as ChatPayload} from "./ChatPayload.js";
export {default as ConsolePayload} from "./ConsolePayload.js";
export {default as DeathPayload} from "./DeathPayload.js";
export {default as JoinLeavePayload} from "./JoinLeavePayload.js";
export {default as StatsPayload} from "./StatsPayload.js";
export {default as StatusPayload} from "./StatusPayload.js";