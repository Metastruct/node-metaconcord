import PayloadRequest from "./PayloadRequest.js";
export default interface ConsoleRequest extends PayloadRequest {
	name: "ConsolePayload";
	data: {
		lines: {
			level: string;
			text: string;
		}[];
		/** the backlog sent right after a subscribe, not live output */
		replay?: boolean;
	};
}
