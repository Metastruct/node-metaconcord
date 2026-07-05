import PayloadRequest from "./PayloadRequest.js";

export default interface ReportChatRequest extends PayloadRequest {
	name: "ReportChatPayload";
	data: {
		steamId64: string;
		content: string;
	};
}
