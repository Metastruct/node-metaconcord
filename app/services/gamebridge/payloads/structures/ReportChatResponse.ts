export default interface ReportChatResponse {
	type: "message";
	username: string;
	content: string;
}

export interface QueuedReportChatResponse {
	type: "queued";
	messages: Array<{ username: string; content: string }>;
	reporterSteamId64: string;
}

export interface ResolveReportChatResponse {
	type: "resolve";
	reporterSteamId64: string;
	isResolved: true;
	resolvedBy?: string;
}

export interface InfoReportChatResponse {
	type: "info";
	reporterSteamId64: string;
	content: string;
}
