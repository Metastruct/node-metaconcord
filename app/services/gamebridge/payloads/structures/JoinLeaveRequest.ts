import PayloadRequest from "./PayloadRequest.js";
export default interface JoinLeaveRequest extends PayloadRequest {
	name: "JoinLeavePayload";
	data: {
		player: {
			nick: string;
			steamId64: string;
		};
		reason?: string;
		spawned?: boolean;
	};
}
