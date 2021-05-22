import axios from "axios";
import config from "@/motd.json";
import schedule from "node-schedule";

import { Container } from "@/app/Container";
import { Service } from "@/app/services";

export default class Motd extends Service {
	name = "Motd";
	messages: Array<string>;

	constructor(container: Container) {
		super(container);
		this.messages = [];
		schedule.scheduleJob("0 12 * * *", this.executeJob.bind(this));
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

	private executeJob(): void {
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
}
