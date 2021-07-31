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
];
