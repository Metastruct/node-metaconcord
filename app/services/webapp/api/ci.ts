import { WebApp } from "@/app/services/webapp/index.js";
import { spawn } from "child_process";
import config from "@/config/ci.json" assert { type: "json" };

const FORBIDDEN = 403;
const SUCCESS = 200;
const ERROR = 500;

export default (webApp: WebApp): void => {
	webApp.app.get("/ci/reload", async (req, res) => {
		const bearer = req.headers["authorization"];
		if (!bearer || bearer.length < 1) {
			res.status(FORBIDDEN).send();
			return;
		}

		const token = bearer.split("Bearer ")[1];
		if (token !== config.token) {
			res.status(FORBIDDEN).send();
			return;
		}

		res.status(SUCCESS).send();

		try {
			const args = ["deploy.sh"];
			if (req.query.all) args.push("all");
			spawn("bash", args);
			return;
		} catch (err) {
			res.status(ERROR).send(err.message);
			return;
		}
	});
};
