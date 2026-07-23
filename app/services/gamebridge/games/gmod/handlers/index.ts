import AdminNotifyPayload from "./AdminNotifyPayload.js";
import BanAppealPayload from "./BanAppealPayload.js";
import BanPayload from "./BanPayload.js";
import ChatPayload from "./ChatPayload.js";
import ErrorPayload from "./ErrorPayload.js";
import GmodConnection from "../GmodConnection.js";
import JoinLeavePayload from "./JoinLeavePayload.js";
import NotificationPayload from "./NotificationPayload.js";
import Payload from "./Payload.js";
import RconPayload from "./RconPayload.js";
import ReportChatPayload from "./ReportChatPayload.js";
import StatusPayload from "./StatusPayload.js";
import UnbanPayload from "./UnbanPayload.js";
import VoteKickPayload from "./VoteKickPayload.js";

export {
	Payload,
	AdminNotifyPayload,
	BanAppealPayload,
	BanPayload,
	ChatPayload,
	ErrorPayload,
	JoinLeavePayload,
	NotificationPayload,
	RconPayload,
	ReportChatPayload,
	StatusPayload,
	UnbanPayload,
	VoteKickPayload,
};

// The wire-protocol name (e.g. "StatusPayload") the gmod addon sends is the
// handler class's own declared name, so no separate name mapping is needed.
const handlers: (typeof Payload)[] = [
	AdminNotifyPayload,
	BanAppealPayload,
	BanPayload,
	ChatPayload,
	ErrorPayload,
	JoinLeavePayload,
	NotificationPayload,
	RconPayload,
	ReportChatPayload,
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
