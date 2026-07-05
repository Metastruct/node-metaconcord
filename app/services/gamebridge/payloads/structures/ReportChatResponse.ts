export default interface ReportChatResponse {
	type: "message";
	username: string;
	content: string;
}

export interface QueuedReportChatResponse {
	type: "queued";
	messages: Array<{ username: string; content: string }>;
}

export interface ResolveReportChatResponse {
	type: "resolve";
	isResolved: true;
	resolvedBy?: string;
}

export interface InfoReportChatResponse {
	type: "info";
	content: string;
}
