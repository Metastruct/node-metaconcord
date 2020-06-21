import PayloadRequest from "./PayloadRequest";

export default interface ErrorResponse extends PayloadRequest {
	name: "ErrorPayload";
	error: any;
}
