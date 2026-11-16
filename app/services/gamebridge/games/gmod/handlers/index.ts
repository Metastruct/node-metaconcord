import type GmodConnection from "../GmodConnection.ts";
import AddonsPayload from "./AddonsPayload.ts";
import AdminNotifyPayload from "./AdminNotifyPayload.ts";
import BanAppealPayload from "./BanAppealPayload.ts";
import BanPayload from "./BanPayload.ts";
import ChatPayload from "./ChatPayload.ts";
import ConsolePayload from "./ConsolePayload.ts";
import ErrorPayload from "./ErrorPayload.ts";
import GservPayload from "./GservPayload.ts";
import JoinLeavePayload from "./JoinLeavePayload.ts";
import NotificationPayload from "./NotificationPayload.ts";
import type Payload from "./Payload.ts";
import RconPayload from "./RconPayload.ts";
import ReportChatPayload from "./ReportChatPayload.ts";
import StatsPayload from "./StatsPayload.ts";
import StatusPayload from "./StatusPayload.ts";
import UnbanPayload from "./UnbanPayload.ts";
import VoteKickPayload from "./VoteKickPayload.ts";



// The wire-protocol name (e.g. "StatusPayload") the gmod addon sends is the
// handler class's own declared name, so no separate name mapping is needed.
const handlers: (typeof Payload)[] = [
	AddonsPayload,
	AdminNotifyPayload,
	BanAppealPayload,
	BanPayload,
	ChatPayload,
	ConsolePayload,
	ErrorPayload,
	GservPayload,
	JoinLeavePayload,
	NotificationPayload,
	RconPayload,
	ReportChatPayload,
	StatsPayload,
	StatusPayload,
	UnbanPayload,
	VoteKickPayload,
];

export function attachHandlers(connection: GmodConnection): void {
	for (const handler of handlers) {
		connection.on(handler.name, data => handler.handle(data, connection));
		handler.initialize(connection);
	}
}

export {default as Payload} from "./Payload.ts";
export {default as AddonsPayload} from "./AddonsPayload.ts";
export {default as AdminNotifyPayload} from "./AdminNotifyPayload.ts";
export {default as BanAppealPayload} from "./BanAppealPayload.ts";
export {default as BanPayload} from "./BanPayload.ts";
export {default as ChatPayload} from "./ChatPayload.ts";
export {default as ConsolePayload} from "./ConsolePayload.ts";
export {default as ErrorPayload} from "./ErrorPayload.ts";
export {default as GservPayload} from "./GservPayload.ts";
export {default as JoinLeavePayload} from "./JoinLeavePayload.ts";
export {default as NotificationPayload} from "./NotificationPayload.ts";
export {default as RconPayload} from "./RconPayload.ts";
export {default as ReportChatPayload} from "./ReportChatPayload.ts";
export {default as StatsPayload} from "./StatsPayload.ts";
export {default as StatusPayload} from "./StatusPayload.ts";
export {default as UnbanPayload} from "./UnbanPayload.ts";
export {default as VoteKickPayload} from "./VoteKickPayload.ts";
