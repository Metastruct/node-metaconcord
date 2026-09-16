import { WebApp } from "@/app/services/webapp/index.js";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const TTL = 60 * 1000;
const RETRY = 5 * 60 * 1000;
const CACHE_CONTROL = "public, max-age=60, stale-while-revalidate=300";

type Widget = {
	id: string;
	name: string;
	instant_invite: string | null;
	presence_count: number;
	members: { game?: { name: string } }[];
};

let cached: { data: Widget; expires: number } | undefined;
let refreshing: Promise<void> | undefined;
let lastAttempt = 0;

/** Discord guild widget, fetched server-side so browsers don't have to reach discord.com. */
export default (webApp: WebApp): void => {
	webApp.app.get("/discord/guild/widget", async (_, res) => {
		const bot = webApp.container.getService("DiscordBot");
		const guild = bot.getGuild();
		if (!guild) {
			res.status(503).json({ error: "bot is not in the guild" });
			return;
		}

		const now = Date.now();
		const fresh = !!cached && cached.expires >= now;
		const backedOff = !cached && now - lastAttempt < RETRY;
		if (!fresh && !backedOff) {
			lastAttempt = now;
			refreshing ??= bot.discord.rest
				.get(`/guilds/${guild.id}/widget.json`)
				.then((data: Widget) => {
					cached = { data, expires: Date.now() + TTL };
				})
				.finally(() => {
					refreshing = undefined;
				});
		}
		if (refreshing) {
			try {
				await refreshing;
			} catch (err) {
				log.warn(err, "failed fetching the guild widget");
			}
		}

		if (!cached) {
			res.status(502).json({ error: "widget unavailable" });
			return;
		}

		res.set("Cache-Control", CACHE_CONTROL);
		res.json(cached.data);
	});
};
