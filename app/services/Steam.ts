import { IService } from ".";
import SteamAPI from "steamapi";
import axios from "axios";
import config from "@/steam.json";
import qs from "qs";

type UserCache = {
	expireTime: number;
	summary: any; // From Steam, cba
};
const validTime = 30 * 60 * 1000;

export class Steam implements IService {
	serviceName = "SteamAPI";

	steam: SteamAPI = new SteamAPI(config.apiKey);
	private userCache: {
		[steamId64: string]: UserCache;
	} = {};

	async getUserSummaries(steamId64: string): Promise<any> {
		const userCache = this.getUserCache(steamId64);
		if (!userCache.summary) {
			userCache.summary = await this.steam.getUserSummary(steamId64).catch(err => {
				console.error(err.message, steamId64);
			});
		}
		return userCache.summary;
	}

	async getPublishedFileDetails(ids: string[]): Promise<any> {
		const query = {
			publishedfileids: ids,
			itemcount: ids.length,
			key: config.apiKey,
		};
		return (
			await axios
				.post(
					`https://api.steampowered.com/ISteamRemoteStorage/GetPublishedFileDetails/v1`,
					qs.stringify(query)
				)
				.catch(err => {
					console.error(err);
					return { data: { response: {} } };
				})
		).data.response;
	}

	private getUserCache(steamId64): UserCache {
		if (!this.userCache[steamId64] || this.userCache[steamId64].expireTime < Date.now()) {
			this.userCache[steamId64] = {
				expireTime: Date.now() + validTime,
				summary: null,
			};
		}
		return this.userCache[steamId64];
	}
}

export default (): IService => {
	return new Steam();
};
