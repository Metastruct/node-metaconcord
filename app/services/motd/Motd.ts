import { Container } from "@/app/Container";
import { Data, Service } from "@/app/services";
import { scheduleJob } from "node-schedule";
import FormData from "form-data";
import axios, { AxiosResponse } from "axios";
import config from "@/config/motd.json";
import dayjs from "dayjs";

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

export default class Motd extends Service {
	name = "Motd";
	messages: Array<string>;
	images: Array<ImgurImage>;
	lastimage?: string;

	private data: Data;
	private rerolls = 0;

	constructor(container: Container) {
		super(container);
		this.messages = [];
		this.lastimage = undefined;
		scheduleJob("0 12 * * *", this.executeMessageJob.bind(this));
		scheduleJob("0 20 * * *", this.executeImageJob.bind(this));
		scheduleJob("0 0 * * 0", this.clearImageAlbumAndHistory.bind(this));
		const data = this.container.getService("Data");
		if (!data) return;
		this.data = data;
		axios
			.get(`https://api.imgur.com/3/album/${config.imgurAlbumId}/images`, {
				headers: {
					Authorization: `Client-ID ${config.imgurClientId}`,
				},
			})
			.then(res => {
				if (res.status === 200) {
					this.images = res.data.data;
				}
			});
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
		data.append("deletehashes[]", "");
		// this errors but works ?
		axios
			.post(`https://api.imgur.com/3/album/${config.imgurDeleteHash}?deletehashes[]=`, data, {
				headers: {
					Authorization: `Client-ID ${config.imgurClientId}`,
				},
			})
			.catch();
		if (this.data) {
			this.data.lastIotdAuthors = [];
			this.data.save();
		}
	}

	private async executeMessageJob(): Promise<void> {
		if (this.messages.length <= 0) return;

		const msg: string = this.messages[Math.floor(Math.random() * this.messages.length)];
		this.messages = [];
		if (msg == null || msg.length === 0) return;

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
		this.container.getService("Twitter")?.postStatus(msg);
	}

	private async executeImageJob(patch?: boolean, msgId?: string): Promise<void> {
		const res = await axios.get(`https://api.imgur.com/3/album/${config.imgurAlbumId}/images`, {
			headers: {
				Authorization: `Client-ID ${config.imgurClientId}`,
			},
		});

		if (res.status === 200) {
			const yesterday = dayjs().subtract(1, "d").unix();
			const lastAuthors = this.data.lastIotdAuthors;
			this.images = res.data.data;
			const urls: Array<ImgurImage> = res.data.data.filter(
				(img: ImgurImage) => img.datetime >= yesterday && !lastAuthors.includes(img.title)
			); // keep only recent images
			const authors = [...new Set(urls.map(image => image.title))];
			const index = Math.floor(Math.random() * urls.length);
			const image = urls[index];
			const url: string = image.link;
			if (!url) return;

			let msg = `Image of the day\n(No. ${index + 1} out of ${urls.length} total from ${
				authors.length
			} user${authors.length > 1 ? "s" : ""})`;

			if (patch !== undefined && msgId) {
				this.rerolls++;
				msg = `Image of the day\n(No. ${index + 1} out of ${urls.length} total from ${
					authors.length
				} user${authors.length > 1 ? "s" : ""})\n(♻ rerolled ${this.rerolls}x)`;
				await axios.patch(
					`${config.webhook}/messages/${msgId}`,
					JSON.stringify({
						content: msg + `\n${url}`,
						username: "Meta Construct",
						avatar_url:
							"https://pbs.twimg.com/profile_images/1503242277/meta4_crop.png",
					}),
					{
						headers: {
							"Content-Type": "application/json",
						},
					}
				);
			} else {
				this.rerolls = 0;
				await axios.post(
					config.webhook,
					JSON.stringify({
						content: msg + `\n${url}`,
						username: "Meta Construct",
						avatar_url:
							"https://pbs.twimg.com/profile_images/1503242277/meta4_crop.png",
					}),
					{
						headers: {
							"Content-Type": "application/json",
						},
					}
				);
			}
			this.container.getService("Twitter")?.postStatus(msg, url);
			this.container.getService("DiscordBot")?.setServerBanner(url);

			this.lastimage = url;
			this.data.lastIotdAuthors.push(image.title);
			await this.data.save();
		}
	}
	async rerollImageJob(): Promise<void> {
		if (!(await this.container.getService("DiscordBot")?.overLvl2())) return;
		const lastmsg = await this.container.getService("DiscordBot")?.getLastMotdMsg();
		if (!lastmsg) return;
		await this.container.getService("Twitter")?.deleteLastIotd(); // todo: fix this after we have markov or something else working also could be troublesome if it was triggered after the messagejob

		await this.executeImageJob(true, lastmsg.id);
		await this.container.getService("DiscordBot")?.removeMotdReactions();
	}

	async getImageInfo(id: string): Promise<ImgurImage | undefined> {
		const res = (await axios.get(`https://api.imgur.com/3/image/${id}`, {
			headers: {
				Authorization: `Client-ID ${config.imgurClientId}`,
			},
		})) as AxiosResponse<ImgurResponse>;
		if (res.data.status === 200) {
			return res.data.data;
		}
	}
}
