import GameBridge from "./GameBridge.js";
import { Provider } from "@/app/services/Accounts.js";

/**
 * In-game account linking: the profile page hands out a code, the player types
 * `METACONCORD_LINK <code>` in game chat, and the chat relay lands here with the
 * identity the game server vouches for. The message is never relayed to Discord.
 */

const LINK_RE = /^METACONCORD_LINK\s+([A-Za-z0-9]{8})$/;

export const matchLinkCode = (content: string): string | undefined =>
	LINK_RE.exec(content.trim())?.[1]?.toUpperCase();

/** Redeems the code and returns the line to show the player. */
export const redeemLinkFromChat = async (
	bridge: GameBridge,
	code: string,
	provider: Provider,
	providerId: string,
	name: string,
	avatar?: string
): Promise<{ ok: boolean; message: string }> => {
	const result = await bridge.container
		.getService("Accounts")
		.redeemLinkCode(code, provider, providerId, name, avatar);
	if ("error" in result)
		return { ok: false, message: `[Metaconcord] Link failed: ${result.error}.` };
	return {
		ok: true,
		message: `[Metaconcord] Linked ${provider} to ${result.account.displayName}'s account.`,
	};
};
