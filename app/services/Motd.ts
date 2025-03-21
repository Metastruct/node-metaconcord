import { Container } from "@/app/Container";
import { DiscordBot, Service } from "@/app/services";
import { scheduleJob } from "node-schedule";
import FormData from "form-data";
import axios, { AxiosResponse } from "axios";
import config from "@/config/motd.json";

type ImgurImage = {
	id: string;
	title: string;
	description: string;
	datetime: number;
	type: string;
	animated: boolean;
	width: number;
	height: number;
	size: number;
	views: number;
	bandwidth: number;
	vote: boolean | null;
	favorite: boolean;
	nsfw: boolean | null;
	section: string | null;
	account_url: string | null;
	account_id: string | null;
	is_ad: boolean;
	in_most_viral: boolean;
	has_sound: boolean;
	tags: Array<string>;
	ad_type: number;
	ad_url: string;
	edited: string;
	in_gallery: boolean;
	link: string;
};

type ImgurResponse = {
	data: any;
	success: boolean;
	status: number;
};

const filter = [
	"again",
	"also",
	"an",
	"and",
	"but",
	"by",
	"come",
	"despite",
	"did",
	"do",
	"done",
	"else",
	"for",
	"has",
	"hasn't",
	"hasnt",
	"have",
	"i'm",
	"if",
	"im",
	"in",
	"instead",
	"is",
	"it's",
	"it",
	"its",
	"like",
	"literally",
	"me",
	"myself",
	"nor",
	"of",
	"rather",
	"so",
	"than",
	"then",
	"there",
	"this",
	"to",
	"was",
	"while",
	"with",
	"yet",
];

export class Motd extends Service {
	name = "Motd";
	messages: string[] = [];
	images: ImgurImage[] = [];
	lastimages: ImgurImage[] = [];

	private bot: DiscordBot;
	private rerolls = 0;

	private ignorelist: Array<string> = ["STEAM_0:1:161162716", "STEAM_0:0:25648317"];

	constructor(container: Container) {
		super(container);
		this.messages = [];
		this.initServices();
		scheduleJob("0 12 * * *", this.executeMessageJob.bind(this));
	}
	private async initServices() {
		const bot = await this.container.getService("DiscordBot");
		this.bot = bot;
	}

	pushMessage(msg: string): void {
		msg = msg.trim();
		if (!this.isValidMsg(msg)) return;

		this.messages.push(msg);
	}

	isValidMsg(msg: string): boolean {
		if (msg.length > 279) return false;
		if (msg.length < 5) return false;
		if (msg.search("^[!\\.\\\\/]") === 0) return false;
		if (msg.search("[a-zA-Z]") === -1) return false;
		if (msg.indexOf("http://") >= 0) return false;
		if (msg.indexOf("https://") >= 0) return false;
		if (msg.indexOf(" ") === -1) return false;

		return true;
	}

	private clearImageAlbumAndHistory(): void {
		const data = new FormData();
		axios
			.post(`https://api.imgur.com/3/album/${config.imgurAlbumDeleteHash}`, data, {
				headers: {
					Authorization: `Client-ID ${config.imgurClientId}`,
				},
			})
			.catch();
		this.lastimages = [];
	}

	async executeMessageJob(): Promise<void> {
		if (this.messages.length <= 0) return;

		const msg: string = this.messages[(Math.random() * this.messages.length) | 0];
		this.messages = [];
		if (msg == null || msg.length === 0) return;
		const data = await this.container.getService("Data");
		data.lastMotd = msg;
		data.save();

		await axios.post(
			config.webhook + "?wait=true",
			JSON.stringify({
				content: msg,
				username: "Meta Construct",
				avatar_url: "https://pbs.twimg.com/profile_images/1503242277/meta4_crop.png",
			}),
			{
				headers: {
					"Content-Type": "application/json",
				},
			}
		);
		await this.setNicknameFromSentence(msg);
	}

	async getImageInfo(id: string): Promise<ImgurImage | undefined> {
		try {
			const res = (await axios.get(`https://api.imgur.com/3/image/${id}`, {
				headers: {
					Authorization: `Client-ID ${config.imgurClientId}`,
				},
			})) as AxiosResponse<ImgurResponse>;
			if (res.data.status === 200) {
				return res.data.data;
			}
		} catch {}
	}

	async setNicknameFromSentence(motd: string): Promise<boolean | undefined> {
		if (motd.length === 0) return;
		let nick = "Meta";
		const wordList = motd
			.split(" ")
			.filter(w => w.length <= 22 && !filter.includes(w.toLowerCase()));
		if (wordList.length === 0) return;
		const word = wordList[(Math.random() * wordList?.length) | 0];
		nick = word.charAt(0).toUpperCase() + word.slice(1);
		return await this.bot.setNickname(nick, "Random Motd name");
	}
}
export default (container: Container): Service => {
	return new Motd(container);
};
