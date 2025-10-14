import { WebApp } from "@/app/services/webapp/index.js";
import GameServer from "@/app/services/gamebridge/GameServer.js";
import nodeHtmlToImage from "node-html-to-image";
import path from "path";
import pug from "pug";
import { access, mkdir, readFile, writeFile } from "fs/promises";
import { constants as fs_constants } from "fs";
import mime from "mime";

const cacheFolder = path.join(process.cwd(), "cache", "map-thumbnails");

const imageToDataURL = async filePath => {
	const mimeType = mime.getType(filePath);
	if (!mimeType) throw new Error("No MIME type from path?");

	const base64 = await readFile(filePath, { encoding: "base64" });
	return `data:${mimeType};base64,${base64}`;
};

export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/server-status/:id{/:bruh}", async (req, res) => {
		const gameBridge = await webApp.container.getService("GameBridge");
		const server: GameServer = gameBridge.servers[req.params.id];

		if (!server) {
			res.status(404).send("ServerID does not exist");
			return;
		}

		if (!Array.isArray(server.status?.players) && server.status?.mapThumbnail != null) {
			res.sendStatus(204);
			return;
		}

		// Discord Bot and Cloudflare
		const discordBot =
			req.headers.accept == "*/*" ||
			!req.headers.accept ||
			req.headers["user-agent"]?.includes("+https://discordapp.com");

		// #region Map Thumbnail
		const mapThumbnail = server.status.mapThumbnail;
		const workshopMap = server.workshopMap;
		let thumbFilepath: string | undefined = undefined;
		if (mapThumbnail?.match(/^https?:\/\//) && workshopMap) {
			await access(cacheFolder, fs_constants.F_OK).catch(() =>
				mkdir(cacheFolder, { recursive: true })
			);

			const _thumbFilepath = path.join(cacheFolder, `${workshopMap.id}`);
			let hasFile = true;
			// have to assume these are the only extensions we expect...
			for (const ext of [".webp", ".jpg", ".jpeg", ".png", ".gif"]) {
				await access(_thumbFilepath + ext, fs_constants.F_OK).catch(() => {
					hasFile = false;
				});
				if (hasFile) {
					thumbFilepath = _thumbFilepath + ext;
					break;
				}
			}
			if (!thumbFilepath) {
				try {
					const response = await fetch(mapThumbnail);
					if (response.ok) {
						const contentType = response.headers.get("content-type");
						if (!contentType) throw new Error("No content-type");

						const ext = mime.getExtension(contentType);
						if (!ext) throw new Error("No extension");

						thumbFilepath = [_thumbFilepath, ext.toLowerCase()].join(".");

						const buffer = Buffer.from(await response.arrayBuffer());
						await writeFile(thumbFilepath, buffer);
					}
				} catch (err) {}
			}
		} else {
			thumbFilepath = mapThumbnail as string;
		}
		const mapThumbnail64 = await imageToDataURL(thumbFilepath);
		// #endregion

		const html = pug.renderFile(
			path.join(process.cwd(), "resources/game-server-status/view.pug"),
			{
				server,
				image: !!discordBot,
				mapThumbnail64,
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
