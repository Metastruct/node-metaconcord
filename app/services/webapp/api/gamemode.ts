import { NodeSSH } from "node-ssh";
import { Stream } from "stream";
import { WebApp } from "..";
import config from "@/ssh.json";
import servers from "@/gamebridge.servers.json";

const HOSTING_IDS = { 3: true };
export default (webApp: WebApp): void => {
	webApp.app.get("/gamemode/:id", async (req, res) => {
		if (!servers.find(srv => srv.ip == req.ip.toString())) {
			return res.status(503);
		}

		const id = parseInt(req.params.id);
		if (isNaN(id) || !HOSTING_IDS[id]) {
			return res.status(503);
		}

		const srvConfig = config.servers[id];
		const ssh = new NodeSSH();
		await ssh.connect({
			username: srvConfig.username,
			host: srvConfig.host,
			port: srvConfig.port,
			privateKey: config.keyPath,
		});

		const output = new Stream.Writable();
		ssh.exec("gserv", ["merge_repos", "rehash"], {
			stream: "stderr",
			onStdout: buff => output.write(buff),
			onStderr: buff => output.write(buff),
		}).finally(() => output.destroy());

		return res.status(206).pipe(output);
	});
};
