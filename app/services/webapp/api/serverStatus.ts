import { GameServer } from "../../gamebridge";
import WebApp from "../WebApp";
import nodeHtmlToImage from "node-html-to-image";
import path from "path";
import pug from "pug";

export default (webApp: WebApp): void => {
	webApp.app.get("/server-status/:id/:bruh?", async (req, res) => {
		if (!webApp.gameBridge) return res.sendStatus(500);
		const server: GameServer = webApp.gameBridge.servers[req.params.id];
		if (!server) return res.sendStatus(500);

		// Discord Bot and Cloudflare
		const discordBot = req.headers.accept == "*/*" || !req.headers.accept;

		const html = pug.renderFile(path.join(__dirname, "../resources/serverStatus/view.pug"), {
			server,
			image: discordBot,
		});
		if (discordBot) {
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
		} else {
			res.end(html);
		}
	});
};
