import type PayloadRequest from "./PayloadRequest.ts";

type CountdownType =
	| -1 // AOWL_COUNTDOWN_FINISHED
	|  0 // AOWL_COUNTDOWN_RESTART
	|  1 // AOWL_COUNTDOWN_MAPCHANGE
	|  2 // AOWL_COUNTDOWN_CUSTOM
	|  3 // AOWL_COUNTDOWN_SILENT
;

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
			steamId64: string;
			avatar?: string;
			ip: string;
			isAdmin: boolean;
			isAfk?: boolean;
			isBanned: boolean;
			isLinux?: boolean;
			nick: string;
			isPirate?: boolean;
			entIndex?: number;
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
		gamemodes?: string[];
	};
}
