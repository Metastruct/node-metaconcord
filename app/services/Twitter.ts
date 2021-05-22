import { Container } from "@/app/Container";
import { Service } from ".";
import Filter from "bad-words";
import axios from "axios";
import config from "@/twitter.json";
import jwt from "jsonwebtoken";
import twit from "twit";

export class Twitter extends Service {
	name = "Twitter";
	filter = new Filter();
	twit = new twit({
		consumer_key: config.consumer_key,
		consumer_secret: config.consumer_secret,
		access_token: config.access_token,
		access_token_secret: config.access_token_secret,
	});
	followerIds: Array<string> = [];
	userStream: twit.Stream;
	followerStream: twit.Stream;

	constructor(container: Container) {
		super(container);
		this.twit.get(
			"followers/ids",
			{ user_id: config.id, stringify_ids: true },
			(err, res: { ids: Array<string> }) => {
				if (err) {
					console.error(err);
					return;
				}

				this.followerIds = res.ids;
			}
		);

		this.userStream = this.twit.stream("user");
		this.userStream.on("follow", ev => {
			const user: twit.Twitter.User = ev.source;
			this.followerIds.push(user.id_str);
			this.initializeFollowerStream();
		});

		this.userStream.on("unfollow", ev => {
			const user: twit.Twitter.User = ev.source;
			this.followerIds = this.followerIds.filter(id => id !== user.id_str);
			this.initializeFollowerStream();
		});

		this.initializeFollowerStream();
	}

	private initializeFollowerStream(): void {
		this.followerStream?.stop(); // just in case it already exists
		this.followerStream = this.twit.stream("statuses/filter", { follow: this.followerIds });
		this.followerStream.on("tweet", (data: twit.Twitter.Status) => {
			const mentions = data.entities.user_mentions.map(mention => mention.id_str);
			const isMentioned = mentions.includes(config.id);
			if (
				isMentioned ||
				data.in_reply_to_user_id_str === config.id ||
				(!data.in_reply_to_status_id && Math.random() <= 0.1)
			) {
				this.replyMarkovToStatus(data.id_str);
			}
		});
	}

	private replyMarkovToStatus(statusId: string): void {
		let gen = this.container.getService("Markov").generate();
		gen = this.filter.clean(gen);
		this.twit.post("statuses/update", {
			status: gen,
			in_reply_to_status_id: statusId,
			auto_populate_reply_metadata: true,
		});
	}

	public async postStatus(status: string): Promise<void> {
		if (status.length < 2 || status.length > 279) return;

		const time = Math.floor(new Date().getTime() / 1000);
		const data = {
			tweet: this.filter.clean(status),
			exp: time + 3600,
			iat: time,
			iss: "#motd",
		};

		const token = jwt.sign(data, config.token);
		const ret = await axios.get(`http://g2.metastruct.net:20080/dotweet?token=${token}`);
		if (ret.status !== 200) {
			if (ret.status == 503 && ret.headers["Retry-After"]) {
				const timeout: number = new Number(ret.headers["Retry-After"]).valueOf();
				setTimeout(this.postStatus.bind(this), timeout);
			}
		}
	}
}

export default (container: Container): Service => {
	return new Twitter(container);
};
