import { AddonGame, Addons } from "@/app/services/addons/index.js";
import { Request, Response } from "express";
import { WebApp } from "@/app/services/webapp/index.js";
import { getSession, isTeamMember } from "./auth/github.js";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const GAMES: AddonGame[] = ["gmod", "minecraft"];

/** Sets the cache headers for who is asking; true when private sources may be served. */
const viewer = (req: Request, res: Response): boolean => {
	const authorized = isTeamMember(getSession(req));
	res.set("Vary", "Cookie");
	res.set("Cache-Control", authorized ? "private, no-store" : CACHE_CONTROL);
	return authorized;
};

/**
 * Aggregated per-server addon lists, fed by the gamebridge, see services/addons.
 * Public, except that Metastruct team members also get the sources of the private
 * repos; that response must never be cached by anything but the browser.
 */
export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/addons", (req, res) => {
		const authorized = viewer(req, res);
		const addons = webApp.container.getService("Addons");
		res.json({ servers: addons.getAll().map(e => Addons.forViewer(e, authorized)) });
	});

	webApp.app.get("/addons/:game/:id", (req, res) => {
		const game = req.params.game as AddonGame;
		const id = Number(req.params.id);
		if (!GAMES.includes(game) || !Number.isInteger(id)) {
			res.status(404).json({ error: "unknown server" });
			return;
		}

		const entry = webApp.container.getService("Addons").get(game, id);
		if (!entry) {
			res.status(404).json({ error: "no addon list for this server yet" });
			return;
		}
		res.json(Addons.forViewer(entry, viewer(req, res)));
	});
};
