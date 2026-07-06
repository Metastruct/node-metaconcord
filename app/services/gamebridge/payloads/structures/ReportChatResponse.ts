export type ReportChatResponsePayload =
	| { type: "message"; username: string; content: string; reporterSteamId64: string }
	| {
			type: "queued";
			messages: Array<{ username: string; content: string }>;
			reporterSteamId64: string;
	  }
	| { type: "resolve"; isResolved: true; resolvedBy?: string; reporterSteamId64: string }
	| { type: "info"; content: string; reporterSteamId64: string };

export type QueuedReportChatResponse = Extract<ReportChatResponsePayload, { type: "queued" }>;

export type ResolveReportChatResponse = Extract<ReportChatResponsePayload, { type: "resolve" }>;

export type InfoReportChatResponse = Extract<ReportChatResponsePayload, { type: "info" }>;

export default interface ReportChatResponse {
	data: ReportChatResponsePayload;
	name: "ReportChatPayload";
}
