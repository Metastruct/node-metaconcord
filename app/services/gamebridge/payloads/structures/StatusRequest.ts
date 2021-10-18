import PayloadRequest from "./PayloadRequest";
export default interface StatusRequest extends PayloadRequest {
	name: "StatusPayload";
	data: {
		hostname: string;
		players: {
			accountId?: number;
			nick: string;
			avatar?: string | false; // Metastruct SteamCache can return false...
			isAdmin?: boolean;
			isBanned?: boolean;
			isAfk?: boolean;
		}[];
		map: string;
		workshopMap?: {
			name: string;
			id: string;
		};
		serverUptime: number;
		mapUptime: number;
		gamemode: {
			folderName: string;
			name: string;
		};
	};
}
