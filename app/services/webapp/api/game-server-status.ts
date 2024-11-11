import { GameBridge } from "@/app/services";
import { GameServer } from "../../gamebridge";
import { WebApp } from "..";
import nodeHtmlToImage from "node-html-to-image";
import path from "path";
import pug from "pug";

export default (webApp: WebApp): void => {
	let gameBridge: GameBridge | undefined;
	webApp.app.get("/server-status/:id/:bruh?", async (req, res) => {
		gameBridge = gameBridge || webApp.container.getService("GameBridge");

		if (!gameBridge) {
			console.warn("Game Bridge is missing?");
			return res.sendStatus(503);
		}

		const server: GameServer = gameBridge.servers[req.params.id];

		if (!server) {
			res.status(404).send("ServerID does not exist");
			return;
		}

		if (!Array.isArray(server.status?.players) && server.status?.mapThumbnail != null) {
			return res.sendStatus(204);
		}

		// Discord Bot and Cloudflare
		const discordBot = req.headers.accept == "*/*" || !req.headers.accept;

		const html = pug.renderFile(
			path.join(process.cwd(), "resources/game-server-status/view.pug"),
			{
				server,
				image: !!discordBot,
			}
		);
		if (discordBot) {
			try {
				server.playerListImage = (await nodeHtmlToImage({
					html,
					transparent: true,
					selector: "main",
					puppeteerArgs: {
						args: ["--no-sandbox"],
					},
				})) as Buffer;

				res.set({
					"content-type": "image/png",
					"content-length": server.playerListImage.length,
				});
				res.send(server.playerListImage);
			} catch (err) {
				console.error("game-server-status image failed", err);
				res.send(err);
			}
		} else {
			res.send(html);
		}
	});
};
