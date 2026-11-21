import type PayloadRequest from "./PayloadRequest.ts";
export default interface RconRequest extends PayloadRequest {
	name: "RconPayload";
	data: {
		identifier: string;
		returns: Array<string>;
		errors: Array<string>;
		stdout: string;
	};
}
