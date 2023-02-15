import { Container } from "../Container";
import { Service } from ".";
import axios from "axios";

class MetaBan {
	public sid: string;
	public bannersid: string;
	public unbannersid?: string;
	public b: boolean;
	public banreason: string;
	public unbanreason?: string;
	public whenbanned: number;
	public whenunban: number;
	public whenunbanned?: number;
	public numbans?: number;
	public name: string;
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

	async getBan(steamid: string): Promise<MetaBan | undefined> {
		if (Date.now() - this.lastUpdate > 5 * 60 * 1000) await this.updateCache();
		const cached = this.banCache.find(ban => ban.sid === steamid);
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
