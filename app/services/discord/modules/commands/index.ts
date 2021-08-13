import { DiscordBot } from "../..";
import { GatewayServer, SlashCreator } from "slash-create";
import { MessageOptions } from "slash-create";
import { SlashBanCommand } from "./developer/BanCommand";
import { SlashCustomRoleCommand } from "./CustomRoleCommand";
import { SlashGservCommand } from "./developer/GservCommand";
import { SlashKickCommand } from "./developer/KickCommand";
import { SlashLuaCommand } from "./developer/LuaCommand";
import { SlashMarkovCommand } from "./MarkovCommand";
import { SlashMuteCommand } from "./mute/MuteCommand";
import { SlashRconCommand } from "./developer/RconCommand";
import { SlashRefreshLuaCommand } from "./developer/RefreshLuaCommand";
import { SlashSqlCommand } from "./developer/SqlCommand";
import { SlashUnBanCommand } from "./developer/UnBanCommand";
import { SlashUnmuteCommand } from "./mute/UnmuteCommand";
import { SlashVaccinatedCommand } from "./VaccinationCommand";
import { SlashWhyBanCommand } from "./WhyBanCommand";
import { SlashWhyMuteCommand } from "./mute/WhyMuteCommand";

export function EphemeralResponse(content: string): MessageOptions {
	return { content, ephemeral: true };
}

export const commands = [
	SlashMarkovCommand,
	SlashMuteCommand,
	SlashUnmuteCommand,
	SlashWhyMuteCommand,
	SlashGservCommand,
	SlashCustomRoleCommand,
	SlashVaccinatedCommand,
	SlashLuaCommand,
	SlashRconCommand,
	SlashRefreshLuaCommand,
	SlashWhyBanCommand,
	SlashBanCommand,
	SlashUnBanCommand,
	SlashKickCommand,
	SlashSqlCommand,
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
		new GatewayServer(handler => bot.discord.ws.on("INTERACTION_CREATE", handler))
	);
	for (const slashCmd of commands) {
		creator.registerCommand(new slashCmd(bot, creator));
	}

	creator.syncCommands();
};
