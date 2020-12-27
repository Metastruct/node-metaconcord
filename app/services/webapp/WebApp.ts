import { BaseClient } from "../discord/BaseClient";
import { GameBridge } from "../gamebridge";
import { Server as HTTPServer } from "http";
import { IService } from "..";
import APIs from "./api";
import config from "@/webapp.json";
import express from "express";

export default class WebApp implements IService {
	serviceName = "WebApp";

	discord: BaseClient;
	gameBridge: GameBridge;
	http: HTTPServer;
	config = config;
	app = express();

	constructor(discord: BaseClient) {
		this.discord = discord;

		for (const addAPI of APIs) {
			addAPI(this);
		}

		this.http = this.app.listen(this.config.port, "0.0.0.0", () => {
			console.log(`HTTP server listening on ${this.config.port}`);
		});
	}
}
