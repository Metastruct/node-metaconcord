import SteamID from "steamid";

/**
 * banni stores who issued a ban as free text in bannersid/unbannersid: a Steam2 id when it
 * happened in game, "Discord (name|<@id>)" from the slash commands, "GitHub (login)" from the
 * website. This is the one place that knows those shapes.
 */
export type BanActor =
	| { kind: "steam"; steamId: string; steamId64?: string }
	| { kind: "discord"; name: string; mention?: string }
	| { kind: "github"; login: string }
	| { kind: "system"; name: string }
	| { kind: "unknown"; raw: string };

// non greedy name so a username containing "|" keeps the last field as the mention
const DISCORD_RE = /^Discord\s*\((.*)\|(.*)\)\s*$/;
/**
 * Automated banners. "hardbans" is the cross-server blacklist: unlike every other actor it
 * never writes the permanent sentinel, it writes an arbitrary far future expiry (seen from
 * 569 to 4768 days out), so its bans have to be treated as permanent by their banner instead.
 */
export const HARDBAN_ACTOR = "hardbans";
const SYSTEM_ACTORS = [HARDBAN_ACTOR, "Console"];

// github logins are alphanumeric with single hyphens, 39 chars max
const GITHUB_RE = /^GitHub\s*\(([A-Za-z0-9-]{1,39})\)\s*$/i;

export const parseBanActor = (raw?: string): BanActor | undefined => {
	if (!raw) return undefined;

	const system = SYSTEM_ACTORS.find(name => name.toLowerCase() === raw.toLowerCase());
	if (system) return { kind: "system", name: system };

	const github = GITHUB_RE.exec(raw);
	if (github) return { kind: "github", login: github[1] };

	const discord = DISCORD_RE.exec(raw);
	if (discord) {
		const name = discord[1].trim();
		const mention = discord[2].trim();
		return { kind: "discord", name: name || raw, mention: mention || undefined };
	}

	try {
		const sid = new SteamID(raw);
		if (sid.isValid()) {
			return { kind: "steam", steamId: raw, steamId64: sid.getSteamID64() };
		}
	} catch {
		// not a steamid, fall through
	}

	return { kind: "unknown", raw };
};

/** Identity string stored in bannersid/unbannersid for actions taken on the website. */
export const githubActor = (login: string): string => `GitHub (${login})`;

/** Short human label, used for Discord embed titles and log lines. */
export const actorLabel = (actor?: BanActor): string => {
	if (!actor) return "???";
	switch (actor.kind) {
		case "steam":
			return actor.steamId;
		case "discord":
			return actor.name;
		case "github":
			return `${actor.login} (GitHub)`;
		case "system":
			return actor.name;
		case "unknown":
			return actor.raw;
	}
};
