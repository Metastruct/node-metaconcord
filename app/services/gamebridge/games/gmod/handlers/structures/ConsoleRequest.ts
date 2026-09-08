import PayloadRequest from "./PayloadRequest.js";
export default interface ConsoleRequest extends PayloadRequest {
	name: "ConsolePayload";
	data: {
		lines: {
			level: string;
			text: string;
			/** "rrggbb" from the engine spew colour, absent when the line had none */
			color?: string;
		}[];
		/** the backlog sent right after a subscribe, not live output */
		replay?: boolean;
	};
}
