import type PayloadRequest from "./PayloadRequest.ts";
export default interface BanAppealRequest extends PayloadRequest {
	name: "BanAppealPayload";
	data: {
		player: {
			nick: string;
			steamId: string;
		};
		banned: { nick: string; steamId: string };
		banReason: string;
		appeal: string;
		unbanTime: string;
	};
}
