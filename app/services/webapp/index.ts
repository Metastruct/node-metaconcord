import { Container } from "@/app/Container";
import { Server as HTTPServer } from "http";
import { Service } from "@/app/services";
import APIs from "./api";
import config from "@/config/webapp.json";
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
	}
}

export default (container: Container): Service => {
	return new WebApp(container);
};
