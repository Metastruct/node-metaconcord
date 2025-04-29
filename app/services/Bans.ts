import { Container, Service } from "../Container.js";
import SteamID from "steamid";
import axios from "axios";

class MetaBan {
	public b: boolean;
	public bannersid: string;
	public banreason: string;
	public gamemode?: string;
	public name: string;
	public numbans?: number;
	public sid: string;
	public unbannersid?: string;
	public unbanreason?: string;
	public whenbanned: number;
	public whenunban: number;
	public whenunbanned?: number;
}

export class Bans extends Service {
	name = "Bans";
	private banCache: MetaBan[] = [];
	private lastUpdate = 0;

	async updateCache(): Promise<void> {
		const res = await axios.get<Array<MetaBan>>("http://g2.metastruct.net/bans");
		if (res.status === 200) {
			this.banCache = res.data;
		}
		this.lastUpdate = Date.now();
	}

	async getBan(steamid: string, force?: boolean): Promise<MetaBan | undefined> {
		let steam2: string;
		try {
			steam2 = new SteamID(steamid).getSteam2RenderedID();
		} catch (err) {
			return;
		}
		if (Date.now() - this.lastUpdate > 5 * 60 * 1000 || force) await this.updateCache();
		const cached = this.banCache.find(ban => ban.sid === steam2);
		if (cached) return cached;
		return undefined;
	}

	async getBanList(): Promise<MetaBan[] | undefined> {
		if (Date.now() - this.lastUpdate > 5 * 60 * 1000) await this.updateCache();
		const cached = this.banCache;
		if (cached) return cached;
		return undefined;
	}
}

export default async (container: Container): Promise<Service> => {
	const bans = new Bans(container);
	bans.updateCache();
	return bans;
};
