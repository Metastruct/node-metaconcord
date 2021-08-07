import { NodeSSH } from "node-ssh";
import { TextChannel } from "discord.js";
import { WebApp } from "..";
import config from "@/ssh.json";
import discordConfig from "@/discord.json";
import servers from "@/gamebridge.servers.json";

const HOSTING_IDS = { 3: true };
export default (webApp: WebApp): void => {
	const bot = webApp.container.getService("DiscordBot");

	webApp.app.get("/gamemode/:id/", async (req, res) => {
		const isOkIp =
			servers.find(srv => srv.ip == req.ip.toString()) || req.ip.toString() === "127.0.0.1";
		if (!isOkIp) {
			return res.sendStatus(403);
		}

		const id = parseInt(req.params.id);
		if (isNaN(id) || !HOSTING_IDS[id]) {
			return res.sendStatus(403);
		}

		const srvConfig = config.servers[id - 1];
		const ssh = new NodeSSH();
		await ssh.connect({
			username: srvConfig.username,
			host: srvConfig.host,
			port: srvConfig.port,
			privateKey: config.keyPath,
		});

		let output = "";
		await ssh.exec("gserv", ["merge_repos", "rehash"], {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		await ssh.exec("gserv", ["qu", "rehash"], {
			stream: "stderr",
			onStdout: buff => (output += buff),
			onStderr: buff => (output += buff),
		});

		const failed = output.includes("GSERV FAILED");
		if (failed) {
			const guild = await bot.discord.guilds.resolve(bot.config.guildId)?.fetch();
			if (guild) {
				const channel = await guild.channels
					.resolve(bot.config.notificationsChannelId)
					?.fetch();
				await (channel as TextChannel)?.send(
					`<@&${discordConfig.appDeveloperRole} GSERV FAILED ON SERVER ${id}, PLEASE FIX`
				);
			}
		}

		return res
			.status(failed ? 500 : 200)
			.contentType("text/plain")
			.send(output);
	});
};
