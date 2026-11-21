import { SlashBanCommand } from "./Ban.ts";
import { SlashGservCommand } from "./Gserv.ts";
import { SlashKickCommand } from "./Kick.ts";
import { SlashLuaCommand } from "./Lua.ts";
import { SlashRconCommand } from "./Rcon.ts";
import { SlashRefreshLuaCommand } from "./RefreshLua.ts";
import { SlashUnBanCommand } from "./UnBan.ts";

export const gmodSlashCommands = [
	SlashBanCommand,
	SlashGservCommand,
	SlashKickCommand,
	SlashLuaCommand,
	SlashRconCommand,
	SlashRefreshLuaCommand,
	SlashUnBanCommand,
];
