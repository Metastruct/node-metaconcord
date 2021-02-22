import { WebApp } from "..";
import express from "express";
import path from "path";

export default (webApp: WebApp): void => {
	webApp.app.use(
		"/map-thumbnails/",
		express.static(path.join(__dirname, "../resources/map-thumbnails"))
	);
};
