import PayloadRequest from "./PayloadRequest.js";
export default interface AdvancementRequest extends PayloadRequest {
	name: "AdvancementPayload";
	data: {
		player: {
			nick: string;
			uuid: string;
		};
		/** @maxLength 256 */
		title: string;
		/** @maxLength 1000 */
		description: string;
		/** the advancement's frame type */
		type: "task" | "goal" | "challenge";
	};
}
