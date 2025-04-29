import PayloadRequest from "./PayloadRequest.js";
export default interface UnbanRequest extends PayloadRequest {
	name: "UnbanPayload";
	data: {
		player: {
			nick: string;
			steamId: string;
		};
		banned: { nick: string; steamId: string };
		banReason: string;
		unbanReason: string;
		banTime: string;
	};
}
