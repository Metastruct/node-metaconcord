import type { NextFunction, Request, Response } from "express";
import { WebApp } from "@/app/services/webapp/index.js";
import { rateLimitKeyGenerator } from "@/app/services/webapp/rateLimit.js";
import { rateLimit } from "express-rate-limit";
import GameBridgeConfig from "@/config/gamebridge.json" with { type: "json" };
import SteamID from "steamid";

/**
 * Account lookups for the game servers, authenticated with the gamebridge token
 * (the same X-Auth-Token the gmod addon and the Minecraft mod send). aowl and the
 * Minecraft mod rank players from these, join_extra_info prints them.
 */

const GAME_PROVIDERS = ["steam", "minecraft"] as const;
type GameProvider = (typeof GAME_PROVIDERS)[number];

const isGameProvider = (value: unknown): value is GameProvider =>
	typeof value === "string" && (GAME_PROVIDERS as readonly string[]).includes(value);

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Canonical platform id, or undefined when it does not parse. */
const normalizeId = (provider: GameProvider, raw: string): string | undefined => {
	if (provider === "steam") {
		try {
			return new SteamID(raw).getSteamID64();
		} catch {
			return;
		}
	}
	return UUID_RE.test(raw) ? raw.toLowerCase() : undefined;
};

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

	// ?provider=steam or minecraft, required; steam entries also carry steamId64, minecraft ones uuid
	webApp.app.get("/accounts/staff", limiter, requireServerToken, async (req, res) => {
		const provider = req.query.provider;
		if (!isGameProvider(provider)) {
			res.status(400).json({ error: "provider must be steam or minecraft" });
			return;
		}
		const staff = (await accounts().staff(provider)).map(entry => ({
			id: entry.providerId,
			name: entry.name,
			roles: entry.roles,
			...(provider === "steam"
				? { steamId64: entry.providerId }
				: { uuid: entry.providerId }),
		}));
		res.json({ provider, staff });
	});

	webApp.app.get("/accounts/:provider/:id", limiter, requireServerToken, async (req, res) => {
		const provider = req.params.provider;
		if (!isGameProvider(provider)) {
			res.status(404).json({ error: "unknown provider" });
			return;
		}
		const id = normalizeId(provider, req.params.id);
		if (!id) {
			res.status(400).json({ error: `invalid ${provider} id` });
			return;
		}
		const account = await accounts().byLink(provider, id);
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
