import { Container, Service } from "@/app/Container.js";
import { Server as HTTPServer } from "http";
import APIs from "./api/index.js";
import config from "@/config/webapp.json" with { type: "json" };
import express from "express";
import { pinoHttp } from "pino-http";
import { logger } from "@/utils.js";

const log = logger("WebApp");

export class WebApp extends Service {
	name = "WebApp";
	config = config;
	app = express();
	http: HTTPServer;

	constructor(container: Container) {
		super(container);

		this.app.use(
			pinoHttp({
				logger: log,
				base: undefined,
				level: process.env.LOG_LEVEL || "info",
				autoLogging: { ignore: req => req.url.startsWith("/server-status") },
			})
		);

		for (const addAPI of APIs) {
			addAPI(this);
		}

		this.http = this.app.listen(this.config.port, "0.0.0.0", () => {
			log.info(`HTTP server listening on ${this.config.port}`);
		});

		this.app.set("trust proxy", 2);
	}
}

export default (container: Container): Service => {
	return new WebApp(container);
};
