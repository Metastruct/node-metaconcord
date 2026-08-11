import PayloadRequest from "./PayloadRequest.js";
export default interface JoinLeaveRequest extends PayloadRequest {
	name: "JoinLeavePayload";
	data: {
		player: {
			nick: string;
			uuid: string;
		};
		reason?: string;
		spawned?: boolean;
	};
}
