import { Container } from "@/app/Container";
import { Service } from ".";
import SteamID from "steamid";
import apikeys from "@/config/apikeys.json";
import axios from "axios";
import qs from "qs";

export type PlayerSummary = {
	avatar: string;
	avatarfull: string;
	avatarhash: string;
	avatarmedium: string;
	communityvisiblitystate: number;
	steamid: string;
	profileurl: string;
	created?: number;
	lastlogoff?: number;
	nickname: string;
	realname?: string;
	primaryclanid?: string;
	personastate: number;
	personaname: string;
	personastateflags?: number;
	commentpermission?: number;
	loccountrycode?: string;
	locstatecode?: string;
	loccityid?: number;
	gameserverid?: string;
	gameserversteamid?: string;
	gameextrainfo?: string;
	gameid?: string;
	timecreated: number;
};

type SummariesResponse = {
	response: { players: PlayerSummary[] };
};

type UserCache = {
	expireTime: number;
	summary?: PlayerSummary;
};
const validTime = 30 * 60 * 1000;
const avatarRegExp = /<avatarFull>\s*<!\[CDATA\[\s*([^\s]*)\s*\]\]>\s*<\/avatarFull>/;

export class Steam extends Service {
	name = "Steam";
	private userCache: {
		[steamId64: string]: UserCache;
	} = {};

	async getUserSummaries(steamId64: string): Promise<PlayerSummary | undefined> {
		const userCache = this.getUserCache(steamId64);
		if (!userCache.summary) {
			try {
				const summary = (
					await axios.get<SummariesResponse>(
						"https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/",
						{
							params: {
								key: apikeys.steam,
								steamids: steamId64,
							},
						}
					)
				).data.response.players[0];
				if (summary) {
					const { status } = await axios.head(summary.avatarfull);
					if (status >= 400) {
						const { data } = await axios.get(
							`https://steamcommunity.com/profiles/${steamId64}?xml=1`
						);
						const results = avatarRegExp.exec(data);
						if (results && results[1].trim().length) {
							summary.avatarfull = results[1];
						}
					}
				}
				userCache.summary = summary;
			} catch (err) {
				// do nothing
			}
		}
		return userCache.summary;
	}

	async getPublishedFileDetails(ids: string[]): Promise<any> {
		const query = {
			publishedfileids: ids,
			itemcount: ids.length,
			key: apikeys.steam,
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
		return (await this.getUserSummaries(steamId64).catch())?.avatarfull;
	}

	private getUserCache(steamId64: string): UserCache {
		if (!this.userCache[steamId64] || this.userCache[steamId64].expireTime < Date.now()) {
			this.userCache[steamId64] = {
				expireTime: Date.now() + validTime,
			};
		}
		return this.userCache[steamId64];
	}

	public steamIDToSteamID64(steamid: string): string {
		return new SteamID(steamid).getSteamID64();
	}

	public accountIDToSteamID(accountid: number): string {
		return SteamID.fromIndividualAccountID(accountid).getSteam2RenderedID();
	}
}

export default (container: Container): Service => {
	return new Steam(container);
};
