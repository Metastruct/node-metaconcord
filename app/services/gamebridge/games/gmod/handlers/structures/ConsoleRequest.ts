import PayloadRequest from "./PayloadRequest.js";
export default interface ConsoleRequest extends PayloadRequest {
	name: "ConsolePayload";
	data: {
		lines: {
			level: string;
			/** the whole line, plain, for filtering and search */
			text: string;
			/** "rrggbb" when the whole line is one colour, absent when it is the default */
			color?: string;
			/**
			 * MsgC emits one chunk per colour, so a tagged line arrives in pieces.
			 * Present only when those pieces differ, in which case `color` is unset.
			 */
			parts?: {
				text: string;
				color?: string;
			}[];
		}[];
		/** the backlog sent right after a subscribe, not live output */
		replay?: boolean;
	};
}
