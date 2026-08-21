import { AddonGame } from "@/app/services/addons/index.js";
import { WebApp } from "@/app/services/webapp/index.js";

const CACHE_CONTROL = "public, max-age=300, stale-while-revalidate=3600";
const GAMES: AddonGame[] = ["gmod", "minecraft"];

/** Public, aggregated per-server addon lists. Fed by the gamebridge, see services/addons. */
export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/addons", (_, res) => {
		const addons = webApp.container.getService("Addons");
		res.set("Cache-Control", CACHE_CONTROL);
		res.json({ servers: addons.getAll() });
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
		res.set("Cache-Control", CACHE_CONTROL);
		res.json(entry);
	});
};
