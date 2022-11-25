import PayloadRequest from "./PayloadRequest";
export default interface ErrorRequest extends PayloadRequest {
	name: "ErrorPayload";
	data: {
		hook_error: {
			name: string;
			identifier: string;
			errormsg: string;
		};
	};
}
