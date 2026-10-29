import path from "node:path";
import express from "express";

import { type WebApp } from "#/app/services/webapp/index.js";

export default function addMapThumbnails(webApp: WebApp): void {
	webApp.app.use(
		"/map-thumbnails/",
		express.static(path.join(process.cwd(), "resources/map-thumbnails"))
	);

	webApp.app.use(
		"/favicon.ico",
		express.static(path.join(process.cwd(), "resources/favicon.ico"))
	);
}
