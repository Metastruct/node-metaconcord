import { Container, Service } from "../Container.js";
import { createHash, randomUUID } from "crypto";
import axios from "axios";
import config from "@/config/resonite.json" with { type: "json" };

export type ResoniteSignalLSessionResponse = {
	entity: {
		userId: string;
		token: string;
		created: Date;
		expire: Date;
		rememberMe: boolean;
		secretMachineIdHash: string;
		secretMachineIdSalt: string;
		uidHash: string;
		uidSalt: string;
		originalLoginType: "Password";
		originalLoginId: string;
		logoutUrlClientSide: boolean;
		sessionLoginCounter: number;
		sourceIP: string;
		userAgent: string;
		isMachineBound: boolean;
		partitionKey: string;
		rowKey: string;
		eTag: unknown;
	};
};

export type ResoniteSession = {
	name: string;
	description: string;
	correspondingWorldId: null;
	tags: string[];
	sessionId: string;
	normalizedSessionId: string;
	hostUserId: string;
	hostUserSessionId: string;
	hostMachineId: string;
	hostUsername: string;
	compatibilityHash: string;
	systemCompatibilityHash: string;
	dataModelAssemblies: [{ name: string; compabilityHash: string }];
	universeId: unknown;
	appVersion: string;
	headlessHost: boolean;
	sessionURLs: string[];
	parentSessionIds: unknown[];
	nestedSessionIds: unknown[];
	sessionUsers: [
		{
			username: string;
			userID: string;
			userSessionId: unknown;
			isPresent: boolean;
			outputDevice: unknown;
		},
	];
	thumbnailUrl: string;
	joinedUsers: number;
	activeUsers: number;
	totalJoinedUsers: number;
	totalActiveUsers: number;
	maxUsers: number;
	mobileFriendly: boolean;
	sessionBeginTime: Date;
	lastUpdate: Date;
	accessLevel: "Anyone" | "RegisteredUsers" | "ContactPlus" | "Contact" | "Private" | "LAN";
	hideFromListing: boolean;
	broadcastKey: unknown;
	hasEnded: boolean;
	isValid: boolean;
};

export type ResoniteUser = {
	id: string;
	username: string;
	// entitlements?: {
	// 	$type: string;
	// }[];
	normalizedUsername: string;
	registrationDate: Date;
	isVerified: boolean;
	isLocked: boolean;
	supressBanEvasion: boolean;
	"2fa_login": boolean;
	profile?: {
		iconUrl: string;
		displayBadges: string[];
	};
};

export class Resonite extends Service {
	name = "Resonite";
	ResoniteUserCache: Record<string, ResoniteUser> = {};

	ResoniteToken: string;
	LastTokenTime: number;
	UserID = config.userID;
	Username = config.username;

	async GetResoniteUser(id: string, forceFetch = false) {
		const cached = this.ResoniteUserCache[id];
		if (cached && !forceFetch) return cached;
		const res = await axios.get<ResoniteUser>(`https://api.resonite.com/users/${id}`).catch();
		if (res) {
			this.ResoniteUserCache[id] = res.data;
			return res.data;
		}
		return undefined;
	}

	async GetResoniteUserAvatarURL(id: string) {
		const user = await this.GetResoniteUser(id);
		if (!user || !user.profile) return;
		return `https://assets.resonite.com/${
			/resdb:\/\/\/(.+)\./.exec(user.profile.iconUrl)?.[1]
		}`;
	}

	async GetOrFetchToken(): Promise<void> {
		const data = await this.container.getService("Data");
		let lastToken = data.lastResoniteToken;
		let lastTokenTime = data.lastResoniteTokenTime ?? Date.now();

		if (!lastToken || lastToken == "" || Date.now() - lastTokenTime >= 259_200_000_0) {
			try {
				const UUID = randomUUID();
				const UID = createHash("sha256").update(this.name).digest("hex");
				const res = await axios
					.post<ResoniteSignalLSessionResponse>(
						"https://api.resonite.com/userSessions",
						{
							username: config.username,
							authentication: {
								$type: "password",
								password: config.password,
							},
							secretMachineId: UUID,
							rememberMe: true,
						},
						{
							headers: {
								UID: UID,
							},
						}
					)
					.catch();
				if (res && data) {
					data.lastResoniteToken = lastToken = res.data.entity.token;
					data.lastResoniteTokenTime = lastTokenTime = new Date(
						res.data.entity.created
					).getTime();
					await data.save();
					console.log("Retrieved and saved Resonite Token!");
				}
			} catch (error) {
				console.error(error);
			}
		}
		this.ResoniteToken = lastToken;
		this.LastTokenTime = lastTokenTime;
	}
}
export default (container: Container): Service => {
	const resonite = new Resonite(container);
	resonite.GetOrFetchToken();
	return resonite;
};
