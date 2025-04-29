import { Container, Service } from "@/app/Container.js";
import { Server as HTTPServer } from "http";
import APIs from "./api/index.js";
import config from "@/config/webapp.json" assert { type: "json" };
import express from "express";

export class WebApp extends Service {
	name = "WebApp";
	config = config;
	app = express();
	http: HTTPServer;

	constructor(container: Container) {
		super(container);

		for (const addAPI of APIs) {
			addAPI(this);
		}

		this.http = this.app.listen(this.config.port, "0.0.0.0", () => {
			console.log(`HTTP server listening on ${this.config.port}`);
		});

		this.app.set("trust proxy", 2);
	}
}

export default (container: Container): Service => {
	return new WebApp(container);
};
