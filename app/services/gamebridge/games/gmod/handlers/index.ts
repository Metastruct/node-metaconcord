import AddonsPayload from "./AddonsPayload.js";
import AdminNotifyPayload from "./AdminNotifyPayload.js";
import BanAppealPayload from "./BanAppealPayload.js";
import BanPayload from "./BanPayload.js";
import ChatPayload from "./ChatPayload.js";
import ConsolePayload from "./ConsolePayload.js";
import ErrorPayload from "./ErrorPayload.js";
import GmodConnection from "../GmodConnection.js";
import GservPayload from "./GservPayload.js";
import JoinLeavePayload from "./JoinLeavePayload.js";
import NotificationPayload from "./NotificationPayload.js";
import Payload from "./Payload.js";
import RconPayload from "./RconPayload.js";
import ReportChatPayload from "./ReportChatPayload.js";
import StatsPayload from "./StatsPayload.js";
import StatusPayload from "./StatusPayload.js";
import UnbanPayload from "./UnbanPayload.js";
import VoteKickPayload from "./VoteKickPayload.js";



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

export {default as Payload} from "./Payload.js";
export {default as AddonsPayload} from "./AddonsPayload.js";
export {default as AdminNotifyPayload} from "./AdminNotifyPayload.js";
export {default as BanAppealPayload} from "./BanAppealPayload.js";
export {default as BanPayload} from "./BanPayload.js";
export {default as ChatPayload} from "./ChatPayload.js";
export {default as ConsolePayload} from "./ConsolePayload.js";
export {default as ErrorPayload} from "./ErrorPayload.js";
export {default as GservPayload} from "./GservPayload.js";
export {default as JoinLeavePayload} from "./JoinLeavePayload.js";
export {default as NotificationPayload} from "./NotificationPayload.js";
export {default as RconPayload} from "./RconPayload.js";
export {default as ReportChatPayload} from "./ReportChatPayload.js";
export {default as StatsPayload} from "./StatsPayload.js";
export {default as StatusPayload} from "./StatusPayload.js";
export {default as UnbanPayload} from "./UnbanPayload.js";
export {default as VoteKickPayload} from "./VoteKickPayload.js";
