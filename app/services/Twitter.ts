import { Container } from "@/app/Container";
import { Service } from ".";
import Filter from "bad-words";
import axios from "axios";
import config from "@/twitter.json";
import jwt from "jsonwebtoken";
import twit from "twit";

const FOLLOWER_REFRESH_RATE = 600000; // 10 mins
const RATE_LIMIT_REFRESH_RATE = 7200000; // 2 hours
const TWEET_COUNT_LIMIT = 100;
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
	followerStream: twit.Stream;
	tweetCount = 0;

	constructor(container: Container) {
		super(container);
		this.refreshFollowers();
		setInterval(this.refreshFollowers.bind(this), FOLLOWER_REFRESH_RATE);
		setInterval(() => (this.tweetCount = 0), RATE_LIMIT_REFRESH_RATE);
	}

	private refreshFollowers(): void {
		this.twit.get(
			"followers/ids",
			{ screen_name: "metastruct" },
			(err, res: { ids: Array<number> }) => {
				if (err) {
					console.error(err);
					return;
				}

				this.followerIds = res.ids.map(id => id.toString());
				this.initializeFollowerStream();
			}
		);
	}

	private initializeFollowerStream(): void {
		this.followerStream?.stop(); // just in case it already exists
		this.followerStream = this.twit.stream("statuses/filter", {
			follow: this.followerIds,
			track: "metastruct",
		});

		this.followerStream.on("tweet", (data: twit.Twitter.Status) => {
			if (data.user.id_str === config.id) return; // don't answer yourself :v

			const mentions = data.entities.user_mentions.map(mention => mention.id_str);
			const isMentioned = mentions.includes(config.id);
			if (isMentioned || data.in_reply_to_user_id_str === config.id) {
				this.replyMarkovToStatus(data.id_str);
				return;
			}

			if (data.retweeted || data.is_quote_status || data.possibly_sensitive) return;
			if (data.user.protected) return; // don't reply to users that are "protected"

			if (Math.random() <= 0.1) {
				this.replyMarkovToStatus(data.id_str);
			}
		});
	}

	private replyMarkovToStatus(statusId: string): void {
		if (this.tweetCount >= TWEET_COUNT_LIMIT) return;

		let gen = this.container.getService("Markov").generate();
		gen = this.filter.clean(gen);
		this.twit.post("statuses/update", {
			status: gen,
			in_reply_to_status_id: statusId,
			auto_populate_reply_metadata: true,
		});
		this.tweetCount++;
	}

	public async postStatus(status: string, imageUrl?: string): Promise<void> {
		if (status.length < 2 || status.length > 279) return;

		const time = Math.floor(new Date().getTime() / 1000);
		const data = {
			tweet: this.filter.clean(status),
			exp: time + 3600,
			iat: time,
			iss: "#motd",
			furl: imageUrl,
		};

		const token = jwt.sign(data, config.token);
		const ret = await axios.get(`http://g2.metastruct.net:20080/dotweet?token=${token}`);
		if (ret.status !== 200) {
			if (ret.status == 503 && ret.headers["Retry-After"]) {
				const timeout: number = new Number(ret.headers["Retry-After"]).valueOf();
				setTimeout(() => this.postStatus(status, imageUrl), timeout);
			}
		}
	}

	public async getStatusMediaURLs(url: string): Promise<Array<string>> {
		try {
			const matches = url.match(/[0-9]+$/);
			const statusId = matches[0];
			const res = await this.twit.get("statuses/show", {
				id: statusId,
			});

			if (res.resp.statusCode !== 200) return [];

			const status = res.data as { extended_entities: twit.Twitter.Entities };
			if (!status.extended_entities.media) return [];

			return status.extended_entities.media
				.filter(media => media.type !== "photo")
				.map(media => {
					const data = media as any;
					if (data.video_info) {
						const variants = data.video_info.variants
							.filter(variant => variant.content_type === "video/mp4")
							.sort(
								(x: { bitrate: number }, y: { bitrate: number }) =>
									x.bitrate - y.bitrate
							);
						const variant = variants[variants.length - 1];
						if (variant?.url) return variant.url;
					}

					return media.media_url_https;
				});
		} catch {
			return [];
		}
	}
}

export default (container: Container): Service => {
	return new Twitter(container);
};
