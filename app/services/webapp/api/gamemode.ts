import { WebApp } from "..";
import servers from "@/config/gamebridge.servers.json";

const HOSTING_IDS = { 3: true, 1: true };

export default async (webApp: WebApp): Promise<void> => {
	webApp.app.get("/gamemode/:id/", async (req, res) => {
		const bot = await webApp.container.getService("DiscordBot");
		const ip = req.header("x-forwarded-for")?.split(",")[0];
		if (!ip) return res.sendStatus(403);
		const isOkIp = servers.find(srv => srv.ip === ip);
		if (!isOkIp) return res.sendStatus(403);

		const id = parseInt(req.params.id);
		if (isNaN(id) || !HOSTING_IDS[id]) {
			return res.sendStatus(403);
		}

		const server = bot.bridge.servers[id];
		if (!server) {
			return res.sendStatus(404);
		}
		let output = "";

		await server.sshExec("gserv", ["update_repos", "rehash"], {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		const failed = output.includes("GSERV FAILED");
		if (failed && bot) {
			const guild = bot.getGuild();
			if (guild) {
				const channel = bot.getTextChannel(bot.config.channels.notifications);
				await channel?.send(`GSERV FAILED ON SERVER ${id}, PLEASE FIX`);
				console.error("gamemode switcher", output);
			}
		}

		return res
			.status(failed ? 500 : 200)
			.contentType("text/plain")
			.send(output);
	});
};
