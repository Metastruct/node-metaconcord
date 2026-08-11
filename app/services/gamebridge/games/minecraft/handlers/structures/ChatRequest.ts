import PayloadRequest from "./PayloadRequest.js";
export default interface ChatRequest extends PayloadRequest {
	name: "ChatPayload";
	data: {
		player: {
			nick: string;
			uuid: string;
		};
		/** @maxLength 2000 */
		content: string;
	};
}
