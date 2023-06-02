import PayloadRequest from "./PayloadRequest";

export enum CountdownType {
	AOWL_COUNTDOWN_FINISHED = -1,
	AOWL_COUNTDOWN_RESTART = 0,
	AOWL_COUNTDOWN_MAPCHANGE = 1,
	AOWL_COUNTDOWN_CUSTOM = 2,
	AOWL_COUNTDOWN_SILENT = 3,
}
export default interface StatusRequest extends PayloadRequest {
	name: "StatusPayload";
	data: {
		countdown?: {
			typ: CountdownType;
			time: number;
			text: string;
		};
		defcon?: number;
		hostname?: string;
		players?: {
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
		mapName?: string;
		workshopMap?: {
			name: string;
			id: string;
		};
		serverUptime?: number;
		mapUptime?: number;
		gamemode?: {
			folderName: string;
			name: string;
		};
	};
}
