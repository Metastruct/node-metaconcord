import PayloadRequest from "./PayloadRequest.js";
export default interface BanRequest extends PayloadRequest {
	name: "BanPayload";
	data: {
		player: {
			nick: string;
			steamId: string;
		};
		banned: { nick: string; steamId: string };
		reason: string;
		unbanTime: string;
		gamemode: string | undefined;
	};
}
