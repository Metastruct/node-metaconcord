import PayloadRequest from "./PayloadRequest";
export default interface JoinLeaveRequest extends PayloadRequest {
	name: "JoinLeavePayload";
	player: {
		name: string;
		steamId64: string;
	};
	reason?: string;
	spawned?: boolean;
}
