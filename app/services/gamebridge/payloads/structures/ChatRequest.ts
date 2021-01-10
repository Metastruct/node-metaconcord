import PayloadRequest from "./PayloadRequest";
export default interface ChatRequest extends PayloadRequest {
	name: "ChatPayload";
	data: {
		player: {
			nick: string;
			steamId64: string;
		};
		content: string;
	};
}
