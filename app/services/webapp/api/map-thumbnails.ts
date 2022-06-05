import { WebApp } from "..";
import express from "express";
import path from "path";

export default (webApp: WebApp): void => {
	webApp.app.use(
		"/map-thumbnails/",
		express.static(path.join(require.main?.path ?? ".", "resources/map-thumbnails")) // wtf do I put here if main is undefined?
	);
};
