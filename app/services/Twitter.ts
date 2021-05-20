import { Container } from "@/app/Container";
import { Service } from ".";
import axios from "axios";
import config from "@/twitter.json";
import jwt from "jsonwebtoken";

export class Twitter extends Service {
	name = "Twitter";

	public async postStatus(status: string): Promise<void> {
		if (status.length < 2 || status.length > 279) return;

		const time = Math.floor(new Date().getTime() / 1000);
		const data = {
			tweet: status,
			exp: time + 3600,
			iat: time,
			iss: "#motd",
		};

		const token = jwt.sign(data, config.token, { algorithm: "RS256" });
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
