import { WebApp } from "@/app/services/webapp/index.js";
import { resolveIp } from "./servers.js";

/** Short links that used to live on the metastruct.net express server. */
const REDIRECTS: Record<string, string> = {
	"/loadingscreen": "https://loadingscreen.metastruct.net/",
	"/gallery": "https://loadingscreen.metastruct.net/",
	"/gitlab": "https://gitlab.com/metastruct",
	"/github": "https://github.com/metastruct",
	"/msdnaa": "https://www3.metastruct.net/msdnaa",
	"/discord": "https://discord.gg/CHuxFSd",
	"/re": "https://g2cf.metastruct.net/reauth",
};

const DEFAULT_PASSWORD = "metawebsite";
const DEFAULT_PORT = 27015;

export default (webApp: WebApp): void => {
	for (const [path, target] of Object.entries(REDIRECTS)) {
		webApp.app.get(path, (_, res) => res.redirect(target));
	}

	// steam://connect redirect for a gmod server, by website label (eu1, us1...)
	webApp.app.get("/join/:label{/:pwd}", async (req, res) => {
		const label = req.params.label.toLowerCase();
		const bridge = webApp.container.getService("GameBridge");
		const server = bridge.servers.gmod.find(
			s => s?.config.label?.toLowerCase() === label || s?.config.name?.toLowerCase() === label
		);
		if (!server) {
			res.status(404).send("unknown server");
			return;
		}

		const { config } = server;
		const configIp = Array.isArray(config.ip) ? config.ip[0] : config.ip;
		const ip = (config.address ? await resolveIp(config.address) : undefined) ?? configIp;
		if (!ip) {
			res.status(404).send("server has no public address");
			return;
		}

		const rawPwd = req.query.pwd ?? req.params.pwd ?? DEFAULT_PASSWORD;
		const pwd = String(rawPwd).replace(/[^a-zA-Z*0-9:+\-\s]+/g, "");
		res.redirect(`steam://connect/${ip}:${config.port ?? DEFAULT_PORT}/${pwd}`);
	});
};
