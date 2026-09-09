import { WebApp } from "@/app/services/webapp/index.js";
import servers from "@/config/gmod.servers.json" with { type: "json" };
import { logger } from "@/utils.js";

const log = logger(import.meta);

export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/gamemode/:id", async (req, res) => {
		const bot = webApp.container.getService("DiscordBot");
		const ip = req.header("cf-connecting-ip") ?? req.header("x-forwarded-for")?.split(",")[0];
		if (!ip) {
			res.sendStatus(403);
			return;
		}
		const isOkIp = servers.find(srv => {
			const ips = srv.ip ? (Array.isArray(srv.ip) ? srv.ip : [srv.ip]) : [];
			return ips.includes(ip);
		});
		if (!isOkIp) {
			res.sendStatus(403);
			return;
		}

		const id = parseInt(req.params.id);
		if (isNaN(id) || !servers.some(srv => srv.id === id)) {
			res.sendStatus(403);
			return;
		}

		const server = bot.bridge.servers.gmod[id];
		if (!server) {
			res.sendStatus(404);
			return;
		}
		try {
			const result = await server.runGserv("update_repos rehash");
			const output = result.error ? `${result.output}\n${result.error}` : result.output;

			const failed = !result.ok;
			if (failed && bot) {
				const guild = bot.getGuild();
				if (guild) {
					const channel = bot.getTextChannel(bot.config.channels.notifications);
					await channel?.send(`GSERV FAILED ON SERVER ${id}, PLEASE FIX`);
					log.error(output);
				}
			}

			res.status(failed ? 500 : 200)
				.contentType("text/plain")
				.send(output);
		} catch (err) {
			log.error({ err, server: id }, "gserv failed");
			res.status(500).contentType("text/plain").send(String(err));
		}
	});
};
