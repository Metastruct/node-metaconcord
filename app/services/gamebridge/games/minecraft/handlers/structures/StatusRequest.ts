import PayloadRequest from "./PayloadRequest.js";
export default interface StatusRequest extends PayloadRequest {
	name: "StatusPayload";
	data: {
		hostname: string;
		version: string;
		maxPlayers: number;
		/** seconds since server start */
		uptime: number;
		players: {
			nick: string;
			uuid: string;
		}[];
	};
}
