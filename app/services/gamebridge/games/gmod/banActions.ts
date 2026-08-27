import { luaString, luaStringOrNil } from "@/utils.js";
import GameBridge from "../../GameBridge.js";
import GmodConnection from "./GmodConnection.js";

export type IssueBanInput = {
	/** Steam2 rendered id, what banni keys on */
	steamId: string;
	nick: string;
	/** goes into bannersid, see banActor */
	actor: string;
	reason: string;
	/** absolute unix seconds */
	unbanTime: number;
	/** undefined bans from every gamemode */
	gamemode?: string;
};

export type RevokeBanInput = {
	steamId: string;
	actor: string;
	reason: string;
};

export const buildBanLua = (input: IssueBanInput): string =>
	`if not banni then return false end ` +
	`local data = banni.Ban(${luaString(input.steamId)}, ${luaString(input.nick)}, ` +
	`${luaString(input.actor)}, ${luaString(input.reason)}, ${Math.floor(input.unbanTime)}, ` +
	`false, ${luaStringOrNil(input.gamemode)}) ` +
	`if istable(data) then return data.b else return data end`;

export const buildUnbanLua = (input: RevokeBanInput): string =>
	`if not banni then return false end ` +
	`local data = banni.UnBan(${luaString(input.steamId)}, ${luaString(input.actor)}, ` +
	`${luaString(input.reason)}) ` +
	`if istable(data) then return data.b == false else return data end`;

const isUsable = (server?: GmodConnection): boolean =>
	!!server && !server.disconnected && !!server.wsConnection?.connected;

/**
 * Any connected gmod server will do, banni's store is shared across them.
 * Prefers the given id so the Discord commands keep their explicit server choice.
 */
export const pickGmodServer = (bridge: GameBridge, preferId = 2): GmodConnection | undefined => {
	const preferred = bridge.servers.gmod[preferId];
	if (isUsable(preferred)) return preferred;
	return Object.values(bridge.servers.gmod).find(isUsable);
};

/** undefined when the server never answered, false when banni refused. */
const runBanLua = async (
	server: GmodConnection,
	code: string,
	runner: string
): Promise<boolean | undefined> => {
	try {
		const res = await server.sendLua(code, "sv", runner);
		if (!res) return undefined;
		return res.data.returns.length > 0 && res.data.returns[0] === "true";
	} catch {
		// callLua rejects with "Timeout" after 30s
		return undefined;
	}
};

export const issueBan = async (
	server: GmodConnection,
	input: IssueBanInput,
	runner: string
): Promise<boolean | undefined> => runBanLua(server, buildBanLua(input), runner);

export const revokeBan = async (
	server: GmodConnection,
	input: RevokeBanInput,
	runner: string
): Promise<boolean | undefined> => runBanLua(server, buildUnbanLua(input), runner);
