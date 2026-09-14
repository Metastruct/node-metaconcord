import type { NextFunction, Request, Response } from "express";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import GameBridgeConfig from "@/config/gamebridge.json" with { type: "json" };
import SteamID from "steamid";

/**
 * Account lookups for the game servers, authenticated with the gamebridge token
 * (the same X-Auth-Token the gmod addon reads from data/metaconcord-token.txt).
 * aowl ranks players from these, join_extra_info prints them.
 */

const requireServerToken = (req: Request, res: Response, next: NextFunction): void => {
	if (req.header("x-auth-token") !== GameBridgeConfig.token) {
		res.status(403).json({ error: "bad token" });
		return;
	}
	res.set("Cache-Control", "no-store");
	next();
};

export default (webApp: WebApp): void => {
	const limiter = rateLimit({
		keyGenerator: rateLimitKeyGenerator,
		windowMs: 60_000,
		limit: 600,
	});
	const accounts = () => webApp.container.getService("Accounts");

	webApp.app.get("/accounts/staff", limiter, requireServerToken, async (_, res) => {
		res.json({ staff: await accounts().staff() });
	});

	webApp.app.get("/accounts/steam/:steamId64", limiter, requireServerToken, async (req, res) => {
		let steamId64: string;
		try {
			steamId64 = new SteamID(req.params.steamId64).getSteamID64();
		} catch {
			res.status(400).json({ error: "invalid steamid" });
			return;
		}
		const account = await accounts().bySteam(steamId64);
		if (!account) {
			res.status(404).json({ error: "no account" });
			return;
		}
		res.json({
			id: account.id,
			name: account.displayName,
			roles: account.roles,
			links: account.links
				.filter(l => l.source !== "import")
				.map(l => ({ provider: l.provider, name: l.name })),
		});
	});
};
