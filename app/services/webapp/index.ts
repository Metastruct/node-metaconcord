import { Container, Service } from "@/app/Container.js";
import { Server as HTTPServer } from "http";
import APIs from "./api/index.js";
import config from "@/config/webapp.json" with { type: "json" };
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type pino from "pino";
import { pinoHttp } from "pino-http";
import { logger } from "@/utils.js";

const log = logger("WebApp");

const PATH_IGNORE = [
	"/server-status",
	"/servers",
	"/discord/guild/emojis",
	"/discord/guild/widget",
	"/addons",
	"/auth/me",
];

export class WebApp extends Service {
	name = "WebApp";
	config = config;
	app = express();
	http: HTTPServer;

	constructor(container: Container) {
		super(container);

		this.app.use(
			pinoHttp({
				logger: log as pino.Logger<string, boolean>,
				base: undefined,
				level: process.env.LOG_LEVEL || "info",
				autoLogging: { ignore: req => PATH_IGNORE.some(p => req.path.startsWith(p)) },
			})
		);

		if (
			!this.config.allowedOrigins?.length ||
			!this.config.siteUrl ||
			!this.config.cookieDomain
		) {
			throw new Error(
				"webapp.json needs allowedOrigins, siteUrl and cookieDomain (see webapp.example.json)"
			);
		}
		this.app.use(cors({ origin: this.config.allowedOrigins, credentials: true }));
		this.app.use(cookieParser(this.config.cookieSecret));

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
