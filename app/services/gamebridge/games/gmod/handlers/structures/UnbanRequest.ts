import type PayloadRequest from "./PayloadRequest.ts";
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
