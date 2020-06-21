import * as SteamAPI from "steamapi";
import * as config from "@/steam.config.json";
import { IService } from "../Container";

export class Steam implements IService {
	public name = "SteamAPI";

	public steam: SteamAPI = new SteamAPI(config.apiKey);
	private cachedSummaries: { [steamId64: string]: any }[] = [];

	public async getUserSummaries(steamId64: string): Promise<any> {
		let cached = this.cachedSummaries[steamId64];
		if (!cached || cached.lifespan < Date.now) {
			cached = this.cachedSummaries[steamId64] = {
				lifespan: Date.now() * 30 * 60 * 1000,
				data: await this.steam.getUserSummary(steamId64),
			};
		}
		return cached.data;
	}
}

export default (): IService => {
	return new Steam();
};
