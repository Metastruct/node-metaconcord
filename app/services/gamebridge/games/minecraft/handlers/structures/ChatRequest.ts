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
		/** set for /me, rendered as an emote instead of a normal message */
		emote?: boolean;
	};
}
