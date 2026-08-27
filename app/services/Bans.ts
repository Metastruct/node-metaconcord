import { Container, Service } from "../Container.js";
import SteamID from "steamid";
import axios from "axios";
import { logger } from "@/utils.js";

const log = logger(import.meta);

export type MetaBan = {
	b: boolean;
	bannersid: string;
	banreason: string;
	gamemode?: string;
	name: string;
	numbans?: number;
	sid: string;
	unbannersid?: string;
	unbanreason?: string;
	whenbanned: number;
	whenunban: number;
	whenunbanned?: number;
	appeal?: string;
};

/** banni's "never expires" sentinel. Note this timestamp is 2030-03-17, not infinity. */
export const PERMANENT_UNBAN_TIME = 1_900_000_000;

const TTL = 5 * 60 * 1000;
/** A failed refresh is not retried before this, so an upstream outage isn't hammered. */
const RETRY_AFTER = 30 * 1000;

export type BansStatus = {
	updatedAt: number;
	stale: boolean;
	error?: string;
	count: number;
};

export class Bans extends Service {
	name = "Bans";
	private banCache: MetaBan[] = [];
	private lastSuccess = 0;
	private lastAttempt = 0;
	private lastError: string | undefined;
	private refresh: Promise<void> | undefined;

	async init(): Promise<void> {
		await this.updateCache();
	}

	private async fetchBans(): Promise<void> {
		this.lastAttempt = Date.now();
		try {
			const res = await axios.get<MetaBan[]>("http://g2.metastruct.net/bans");
			if (!Array.isArray(res.data)) throw new Error("ban list is not an array");
			this.banCache = res.data;
			this.lastSuccess = Date.now();
			this.lastError = undefined;
		} catch (err) {
			this.lastError = (err as Error)?.message ?? String(err);
			log.warn(err, "failed refreshing the ban list, keeping the cached copy");
		}
	}

	/** Refreshes when stale, de-duping concurrent callers. Never throws. */
	async updateCache(force = false): Promise<void> {
		const age = Date.now() - this.lastSuccess;
		const sinceAttempt = Date.now() - this.lastAttempt;
		if (!force && age <= TTL) return;
		// after a failure, wait out RETRY_AFTER before trying again
		if (!force && this.lastError && sinceAttempt < RETRY_AFTER) return;

		this.refresh ??= this.fetchBans().finally(() => {
			this.refresh = undefined;
		});
		await this.refresh;
	}

	getStatus(): BansStatus {
		return {
			updatedAt: this.lastSuccess,
			stale: this.lastSuccess === 0 || Date.now() - this.lastSuccess > TTL,
			error: this.lastError,
			count: this.banCache.length,
		};
	}

	async getBan(steamid: string, force?: boolean): Promise<MetaBan | undefined> {
		let steam2: string;
		let steam2N: string;
		try {
			const sid = new SteamID(steamid);
			steam2 = sid.getSteam2RenderedID();
			steam2N = sid.getSteam2RenderedID(true);
		} catch {
			return undefined;
		}
		await this.updateCache(force);
		return this.banCache.find(ban => ban.sid === steam2 || ban.sid === steam2N);
	}

	async getBanList(): Promise<MetaBan[]> {
		await this.updateCache();
		return this.banCache;
	}
}

export default (container: Container): Service => {
	return new Bans(container);
};
