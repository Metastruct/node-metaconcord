import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const TTL = 60 * 1000;
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

type Widget = {
	id: string;
	name: string;
	instant_invite: string | null;
	presence_count: number;
	members: { game?: { name: string } }[];
};

let cached: { data: Widget; expires: number } | undefined;

/** Discord guild widget, fetched server-side so browsers don't have to reach discord.com. */
export default (webApp: WebApp): void => {
	webApp.app.get("/discord/guild/widget", async (_, res) => {
		const bot = webApp.container.getService("DiscordBot");
		const guild = bot.getGuild();
		if (!guild) {
			res.status(503).json({ error: "bot is not in the guild" });
			return;
		}

		if (!cached || cached.expires < Date.now()) {
			try {
				const r = await fetch(`https://discord.com/api/guilds/${guild.id}/widget.json`);
				if (!r.ok) throw new Error(`widget.json ${r.status}`);
				cached = { data: (await r.json()) as Widget, expires: Date.now() + TTL };
			} catch (err) {
				log.warn(err, "failed fetching the guild widget");
				if (!cached) {
					res.status(502).json({ error: "widget unavailable" });
					return;
				}
			}
		}

		res.set("Cache-Control", CACHE_CONTROL);
		res.json(cached.data);
	});
};
