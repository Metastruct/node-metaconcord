import * as SteamAPI from "steamapi";
import * as config from "@/steam.config.json";
import * as qs from "qs";
import { IService } from "../Container";
import axios from "axios";

export class Steam implements IService {
	public name = "SteamAPI";

	public steam: SteamAPI = new SteamAPI(config.apiKey);
	private cachedSummaries: { [steamId64: string]: any }[] = [];

	public async getUserSummaries(steamId64: string): Promise<any> {
		let cached = this.cachedSummaries[steamId64];
		if (!cached || cached.lifespan < Date.now()) {
			cached = this.cachedSummaries[steamId64] = {
				lifespan: Date.now() * 30 * 60 * 1000,
				data: await this.steam.getUserSummary(steamId64),
			};
		}
		return cached.data;
	}

	public async getPublishedFileDetails(ids: string[]): Promise<any> {
		const query = {
			itemcount: 0,
			publishedfileids: [],
			key: config.apiKey,
		};
		for (const id of ids) {
			query.publishedfileids.push(id);
		}
		query.itemcount = query.publishedfileids.length;
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
}

export default (): IService => {
	return new Steam();
};
