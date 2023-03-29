// not really oauth, but yeah, currently tied to discord role linking

import { WebApp } from "..";
//import { createHash } from "crypto";
import { rateLimit } from "express-rate-limit";
import SteamID from "steamid";
import axios from "axios";
// https://steamcommunity.com/openid/login?
// openid.ns=http://specs.openid.net/auth/2.0&
// openid.mode=id_res&
// openid.op_endpoint=https://steamcommunity.com/openid/login&
// openid.claimed_id=https://steamcommunity.com/openid/id/1234&
// openid.identity=https://steamcommunity.com/openid/id/1234&
// openid.return_to=https://mywebsite.com&
// openid.response_nonce=2020-08-28T04:44:16Zs4DPZce8qc+iPCe8JgQKB0BiIDI=&
// openid.assoc_handle=1234567890&
// openid.signed=signed,op_endpoint,claimed_id,identity,return_to,response_nonce,assoc_handle&
// openid.sig=W0u5DRbtHE1GG0ZKXjerUZDUGmc=

export default (webApp: WebApp): void => {
	const sql = webApp.container.getService("SQL");
	if (!sql) return;
	webApp.app.get("/steam/auth/callback/:id", rateLimit(), async (req, res) => {
		const query = req.query;
		const userId = req.params.id;
		if (!userId) res.status(403).send("Missing userid for linking");
		// const signed: string[] = params["openid.signed"].split(",");
		// const buffer = Buffer.from(
		// 	signed.map(entry => `${entry}:${params["openid." + entry]}`).join("\n") + "\n",
		// 	"utf-8"
		// );
		// const hash = createHash("sha1").update(buffer).digest("base64");
		query["openid.mode"] = "check_authentication";
		const valid = await axios.get("https://steamcommunity.com/openid/login", {
			params: query,
		});
		const ident = query["openid.identity"]?.toString();
		if (!valid || valid.data.length === 0 || !ident)
			return res.status(403).send("Invalid Steam Response?");

		const steamId = ident.match(/https:\/\/steamcommunity\.com\/openid\/id\/(\d+)/)?.[1];
		if (!steamId || steamId.length === 0) return res.status(403).send("Invalid SteamID?");
		await sql.queryPool(
			"INSERT INTO discord_link (accountid, discorduserid, linked_at) VALUES($1, $2, $3) ON CONFLICT (accountid) DO UPDATE SET linked_at = $4",
			[new SteamID(steamId).accountid, userId, new Date(), new Date()]
		);
		return res.send("👍, now go back to discord and try linking it again and it should work.");
	});
	webApp.app.get("/steam/link/:id", async (req, res) => {
		const userId = req.params.id;
		if (!userId) res.status(403).send("Missing userid for linking");
		const url = new URL("https://steamcommunity.com/openid/login");
		url.search = new URLSearchParams({
			"openid.ns": "http://specs.openid.net/auth/2.0",
			"openid.claimed_id": "http://specs.openid.net/auth/2.0/identifier_select",
			"openid.identity": "http://specs.openid.net/auth/2.0/identifier_select",
			"openid.return_to": `https://g2cf.metastruct.net/metaconcord/steam/auth/callback/${userId}`,
			"openid.realm": "https://g2cf.metastruct.net/metaconcord",
			"openid.mode": "checkid_setup",
		}).toString();

		res.redirect(url.toString());
	});
};
