import axios from "axios";
import config from "@/motd.json";
import schedule from "node-schedule";

import { Container } from "@/app/Container";
import { Service } from "@/app/services";
import moment from "moment";

export default class Motd extends Service {
	name = "Motd";
	messages: Array<string>;

	constructor(container: Container) {
		super(container);
		this.messages = [];
		schedule.scheduleJob("0 12 * * *", this.executeMessageJob.bind(this));
		schedule.scheduleJob("0 20 * * *", this.executeImageJob.bind(this));
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
		this.container.getService("Twitter").postStatus(msg);
	}

	private async executeImageJob(): Promise<void> {
		const res = await axios.get(`https://api.imgur.com/3/album/${config.imgurAlbumId}/images`, {
			headers: {
				Authorization: `Client-ID ${config.imgurClientId}`,
			},
		});

		if (res.status === 200) {
			const date = moment(Date.now());
			const yesterday = date.subtract(1, "day");
			const urls = res.data.data
				.filter((img: { datetime: number }) => moment(img.datetime).isAfter(yesterday)) // keep only recent images
				.map((img: { link: string }) => img.link);

			const url: string = urls[Math.floor(Math.random() * urls.length)];
			if (!url) return;

			axios.post(
				config.webhook,
				JSON.stringify({
					content: url,
					username: "Meta Construct",
					avatar_url: "https://pbs.twimg.com/profile_images/1503242277/meta4_crop.png",
				}),
				{
					headers: {
						"Content-Type": "application/json",
					},
				}
			);

			this.container.getService("Twitter").postStatus("Image of the day", url);
		}
	}
}
