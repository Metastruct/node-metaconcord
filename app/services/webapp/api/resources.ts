import { WebApp } from "@/app/services/webapp/index.js";
import express from "express";
import path from "path";

export default (webApp: WebApp): void => {
	webApp.app.use(
		"/map-thumbnails/",
		express.static(path.join(process.cwd(), "resources/map-thumbnails"))
	);

	webApp.app.use(
		"/favicon.ico",
		express.static(path.join(process.cwd(), "resources/favicon.ico"))
	);
};
