import { GameBridge } from "@/app/services";
import { GameServer } from "../../gamebridge";
import { WebApp } from "..";
import nodeHtmlToImage from "node-html-to-image";
import path from "path";
import pug from "pug";

export default (webApp: WebApp): void => {
	let gameBridge: GameBridge;
	webApp.app.get("/server-status/:id/:bruh?", async (req, res) => {
		gameBridge = gameBridge || webApp.container.getService("GameBridge");

		if (!gameBridge) {
			console.warn("Game Bridge is missing?");
			return res.sendStatus(503);
		}

		const server: GameServer = gameBridge.servers[req.params.id];
		if (!Array.isArray(server?.status?.players) && server?.status?.mapThumbnail != "") {
			return res.sendStatus(204);
		}

		// Discord Bot and Cloudflare
		const discordBot = req.headers.accept == "*/*" || !req.headers.accept;

		const html = pug.renderFile(
			path.join(require.main?.path ?? ".", "resources/game-server-status/view.pug"), // same here
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
				})) as Buffer;

				res.set({
					"content-type": "image/png",
					"content-length": server.playerListImage.length,
				});
				res.send(server.playerListImage);
			} catch (err) {
				res.send(err);
			}
		} else {
			res.send(html);
		}
	});
};
