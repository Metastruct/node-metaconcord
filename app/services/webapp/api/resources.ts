import { WebApp } from "..";
import express from "express";
import path from "path";

export default (webApp: WebApp): void => {
	webApp.app.use(
		"/map-thumbnails/",
		express.static(path.join(process.cwd(), "resources/map-thumbnails"))
	);
	webApp.app.use(
		"/event-icons/",
		express.static(path.join(process.cwd(), "resources/discord-event-icons"))
	);
	webApp.app.use(
		"/guild-icons/",
		express.static(path.join(process.cwd(), "resources/discord-guild-icons"))
	);
};
