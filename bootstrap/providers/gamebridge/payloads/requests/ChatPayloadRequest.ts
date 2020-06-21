import { PayloadRequest } from "./PayloadRequest";

interface ChatPayloadRequest extends PayloadRequest {
	name: "ChatPayload";
	message: {
		player: {
			name: string;
			steamId64: string;
		};
		content: string;
	};
}

export { ChatPayloadRequest };
