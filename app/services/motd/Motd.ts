import { Container } from "@/app/Container";
import { Data, Service } from "@/app/services";
import { scheduleJob } from "node-schedule";
import FormData from "form-data";
import axios from "axios";
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

export default class Motd extends Service {
	name = "Motd";
	messages: Array<string>;
	lastimage?: string;

	private ignorelist: Array<string> = ["STEAM_0:0:25648317"];
	private data: Data;

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
	}

	public pushMessage(msg: string): void {
		msg = msg.trim();
		if (!this.isValidMsg(msg)) return;

		this.messages.push(msg);
	}

	public isValidMsg(msg: string): boolean {
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
		axios.post(
			`https://api.imgur.com/3/album/${config.imgurDeleteHash}?deletehashes=${config.imgurDeleteHash}`,
			data,
			{
				headers: {
					Authorization: `Client-ID ${config.imgurClientId}`,
				},
			}
		);
		if (this.data) {
			this.data.lastIotdAuthors = [];
			this.data.save();
		}
	}

	private executeMessageJob(): void {
		if (this.messages.length <= 0) return;

		const msg: string = this.messages[Math.floor(Math.random() * this.messages.length)];
		this.messages = [];
		if (msg == null || msg.length === 0) return;

		axios.post(
			config.webhook,
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
			const urls: Array<ImgurImage> = res.data.data.filter(
				(img: ImgurImage) =>
					img.datetime >= yesterday &&
					!lastAuthors[img.title] &&
					!this.ignorelist.some(id => img.title.includes(id))
			); // keep only recent images
			const image = urls[Math.floor(Math.random() * urls.length)];
			const url: string = image.link;
			if (!url) return;

			if (patch !== undefined && msgId) {
				await axios.patch(
					`${config.webhook}/messages/${msgId}`,
					JSON.stringify({
						content: "Image of the day:\n" + url,
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
				await axios.post(
					config.webhook,
					JSON.stringify({
						content: "Image of the day:\n" + url,
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
			this.container.getService("Twitter")?.postStatus("Image of the day", url);
			this.container.getService("DiscordBot")?.setServerBanner(url);

			this.lastimage = url;
			this.data.lastIotdAuthors.push(image.title);
			await this.data.save();
		}
	}
	public async rerollImageJob(): Promise<void> {
		if (!(await this.container.getService("DiscordBot")?.overLvl2())) return;
		const lastmsg = await this.container.getService("DiscordBot")?.getLastMotdMsg();
		if (!lastmsg) return;
		await this.container.getService("Twitter")?.deleteLastIotd(); // todo: fix this after we have markov or something else working also could be troublesome if it was triggered after the messagejob

		await this.executeImageJob(true, lastmsg.id);
		await this.container.getService("DiscordBot")?.removeMotdReactions();
	}
}
