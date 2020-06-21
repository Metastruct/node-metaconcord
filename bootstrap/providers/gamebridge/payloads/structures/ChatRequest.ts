import PayloadRequest from "./PayloadRequest";

export default interface ChatRequest extends PayloadRequest {
	name: "ChatPayload";
	message: {
		player: {
			name: string;
			steamId64: string;
		};
		content: string;
	};
}
