import PayloadRequest from "./PayloadRequest";

export default interface StatusRequest extends PayloadRequest {
	name: "StatusPayload";
	status: {
		hostname: string;
		players: string[];
		map: string;
		workshopMap?: {
			name: string;
			id: string;
		};
		uptime: number;
	};
}
