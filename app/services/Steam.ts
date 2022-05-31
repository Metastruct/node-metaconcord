import { Container } from "@/app/Container";
import { Service } from ".";
import SteamAPI from "steamapi";
import SteamID from "steamid";
import axios from "axios";
import config from "@/config/steam.json";
import qs from "qs";

type UserCache = {
	expireTime: number;
	summary: any; // From Steam, cba
};
const validTime = 30 * 60 * 1000;

export class Steam extends Service {
	name = "Steam";
	steam: SteamAPI = new SteamAPI(config.apiKey);
	private userCache: {
		[steamId64: string]: UserCache;
	} = {};

	async getUserSummaries(steamId64: string): Promise<any> {
		const userCache = this.getUserCache(steamId64);
		if (!userCache.summary) {
			userCache.summary = await this.steam.getUserSummary(steamId64).catch(err => {
				err.message += ` - ${steamId64}`;
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
				.catch(() => {
					return { data: { response: {} } };
				})
		).data.response;
	}

	async getUserAvatar(steamId64: string): Promise<any> {
		return (await this.getUserSummaries(steamId64).catch())?.avatar?.large;
	}

	private getUserCache(steamId64: string): UserCache {
		if (!this.userCache[steamId64] || this.userCache[steamId64].expireTime < Date.now()) {
			this.userCache[steamId64] = {
				expireTime: Date.now() + validTime,
				summary: null,
			};
		}
		return this.userCache[steamId64];
	}

	public steamIDToSteamID64(steamid: string): string {
		return new SteamID(steamid).getSteamID64();
	}
}

export default (container: Container): Service => {
	return new Steam(container);
};
