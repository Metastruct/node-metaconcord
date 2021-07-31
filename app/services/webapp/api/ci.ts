import { WebApp } from "..";
import { spawn } from "child_process";
import config from "@/ci.json";

const FORBIDDEN = 403;
const SUCCESS = 200;
const ERROR = 500;

export default (webApp: WebApp): void => {
	webApp.app.get("/ci/reload", async (req, res) => {
		const bearer = req.headers["authorization"];
		if (!bearer || bearer.length < 1) return res.status(FORBIDDEN).send();

		const token = bearer.split("Bearer ")[1];
		if (token !== config.token) return res.status(FORBIDDEN).send();

		try {
			res.status(SUCCESS).send();
			spawn("deploy.sh");
			return;
		} catch (err) {
			return res.status(ERROR).send(err.message);
		}
	});
};
