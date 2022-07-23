import PayloadRequest from "./PayloadRequest";
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
		unbanTime: string;
	};
}
