import PayloadRequest from "./PayloadRequest.js";
export default interface AdminNotifyRequest extends PayloadRequest {
	name: "AdminNotifyPayload";
	data: {
		player: {
			nick: string;
			steamId: string;
		};
		reported: { nick: string; steamId: string };
		message: string;
	};
}
