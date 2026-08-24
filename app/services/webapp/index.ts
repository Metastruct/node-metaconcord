import { Container, Service } from "@/app/Container.js";
import { Server as HTTPServer } from "http";
import type { Request, Response } from "express";
import APIs from "./api/index.js";
import config from "@/config/webapp.json" with { type: "json" };
import cookieParser from "cookie-parser";
import cors from "cors";
import express from "express";
import type pino from "pino";
import { pinoHttp } from "pino-http";
import { logger } from "@/utils.js";
import { WsRouter } from "./WsRouter.js";

const log = logger("WebApp");

const PATH_IGNORE = [
	"/server-status",
	"/servers",
	"/discord/guild/emojis",
	"/discord/guild/widget",
	"/discord/guild/events",
	"/addons",
	"/auth/me",
	"/dashboard/logs",
	"/dashboard/static",
];

export class WebApp extends Service {
	name = "WebApp";
	config = config;
	app = express();
	http: HTTPServer;
	/** Single WebSocket server for the http server, routes are added by path. */
	ws: WsRouter;

	constructor(container: Container) {
		super(container);

		this.app.use(
			pinoHttp<Request, Response>({
				logger: log,
				base: undefined,
				customLogLevel: (_, res, err): pino.LevelWithSilent =>
					err || res.statusCode >= 500
						? "error"
						: res.statusCode >= 400
							? "warn"
							: "debug",
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

		this.app.set("trust proxy", 2);

		this.http = this.app.listen(this.config.port, "0.0.0.0", () => {
			log.info(`HTTP server listening on ${this.config.port}`);
		});
		this.ws = new WsRouter(this.http);

		for (const addAPI of APIs) {
			addAPI(this);
		}
	}
}

export default (container: Container): Service => {
	return new WebApp(container);
};
