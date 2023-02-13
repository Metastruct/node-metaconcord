import { DiscordBot } from "../..";
import { GatewayDispatchEvents } from "discord.js";
import { GatewayServer, SlashCreator } from "slash-create";
import { MessageOptions } from "slash-create";
import { SlashBanCommand } from "./developer/Ban";
import { SlashCustomRoleCommand } from "./CustomRole";
import { SlashDeeplCommand, UIDeeplCommand } from "./DeepL";
import { SlashEvalCommand } from "./developer/Eval";
import { SlashForceIotdRerollCommand } from "./developer/ForceIotdReroll";
import { SlashGservAllCommand } from "./developer/GservAll";
import { SlashGservCommand } from "./developer/Gserv";
import { SlashKickCommand } from "./developer/Kick";
import { SlashLuaCommand } from "./developer/Lua";
import { SlashMarkovCommand } from "./Markov";
import { SlashMuteCommand, UIMuteCommand } from "./mute/Mute";
import { SlashRconCommand } from "./developer/Rcon";
import { SlashRefreshLuaCommand } from "./developer/RefreshLua";
import { SlashRuleCommand } from "./developer/Rules";
import { SlashSQLCommand } from "./developer/SQL";
import {
	SlashSpeechbubbleCommand,
	UISpeechbubbleLeftCommand,
	UISpeechbubbleRightCommand,
} from "./Speechbubble";
import { SlashUnBanCommand } from "./developer/UnBan";
import { SlashUnmuteCommand, UIUnmuteCommand } from "./mute/Unmute";
import { SlashVaccinatedCommand } from "./Vaccination";
import { SlashWhyBanCommand } from "./WhyBan";
import { SlashWhyMuteCommand, UIWhyMuteCommand } from "./mute/WhyMute";
import { UIStickerYankCommand } from "./StickerYank";

export function EphemeralResponse(content: string): MessageOptions {
	return { content, ephemeral: true };
}

export const commands = [
	SlashBanCommand,
	SlashCustomRoleCommand,
	SlashDeeplCommand,
	SlashEvalCommand,
	SlashForceIotdRerollCommand,
	SlashGservAllCommand,
	SlashGservCommand,
	SlashKickCommand,
	SlashLuaCommand,
	SlashMarkovCommand,
	SlashMuteCommand,
	SlashRconCommand,
	SlashRefreshLuaCommand,
	SlashRuleCommand,
	SlashSpeechbubbleCommand,
	SlashSQLCommand,
	SlashUnBanCommand,
	SlashUnmuteCommand,
	SlashVaccinatedCommand,
	SlashWhyBanCommand,
	SlashWhyMuteCommand,
	UIDeeplCommand,
	UIMuteCommand,
	UIStickerYankCommand,
	UISpeechbubbleLeftCommand,
	UISpeechbubbleRightCommand,
	UIUnmuteCommand,
	UIWhyMuteCommand,
];

export default (bot: DiscordBot): void => {
	const creator = new SlashCreator({
		applicationID: bot.config.applicationId,
		publicKey: bot.config.publicKey,
		token: bot.config.token,
	});
	// Emergency mode lolol
	creator.on("error", console.error);
	creator.on("commandError", console.error);
	creator.on("warn", console.warn);
	// creator.on("debug", console.log);
	// creator.on("ping", console.log);
	// creator.on("rawREST", console.log);
	// creator.on("unknownInteraction", console.log);
	// creator.on("unverifiedRequest", console.log);
	// creator.on("synced", console.log);
	creator.withServer(
		new GatewayServer(handler =>
			bot.discord.ws.on(GatewayDispatchEvents.InteractionCreate, handler)
		)
	);
	for (const slashCmd of commands) {
		creator.registerCommand(new slashCmd(bot, creator));
	}

	creator.syncCommands({ syncPermissions: false });
};
