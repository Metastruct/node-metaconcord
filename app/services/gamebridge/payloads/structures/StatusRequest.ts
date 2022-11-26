import PayloadRequest from "./PayloadRequest";
export default interface StatusRequest extends PayloadRequest {
	name: "StatusPayload";
	data: {
		countdown: boolean;
		defcon: number;
		hostname: string;
		players: {
			accountId: number;
			avatar?: string | false; // Metastruct SteamCache can return false...
			ip: string;
			isAdmin: boolean;
			isAfk?: boolean;
			isBanned: boolean;
			isLinux?: boolean;
			nick: string;
			isPirate?: boolean;
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
