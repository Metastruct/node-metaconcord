import { GameBridge } from "@/app/services";
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

		const server = gameBridge.servers[req.params.id];
		if (!server?.status?.players && !server?.status?.mapThumbnail) {
			console.warn(`No data for server ${req.params.id}`);
			return res.sendStatus(503);
		}

		// Discord Bot and Cloudflare
		const discordBot = req.headers.accept == "*/*" || !req.headers.accept;

		const html = pug.renderFile(path.join(__dirname, "../resources/server-status/view.pug"), {
			server,
			image: !!discordBot,
		});
		if (discordBot) {
			try {
				if (!server.playerListImage) {
					server.playerListImage = (await nodeHtmlToImage({
						html,
						transparent: true,
						selector: "main",
					})) as Buffer;
				}

				res.writeHead(200, {
					"content-type": "image/png",
					"content-length": server.playerListImage.length,
				});
				res.end(server.playerListImage);
			} catch (err) {
				res.send(err);
			}
		} else {
			res.send(html);
		}
	});
};
