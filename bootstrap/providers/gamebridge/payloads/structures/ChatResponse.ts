import PayloadRequest from "./PayloadRequest";

export default interface ChatResponse extends PayloadRequest {
	name: "ChatPayload";
	message: {
		user: {
			name: string;
			color: number;
		};
		content: string;
	};
}
