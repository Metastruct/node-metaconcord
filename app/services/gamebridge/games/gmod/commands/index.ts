import { SlashBanCommand } from "./Ban.js";
import { SlashGservCommand } from "./Gserv.js";
import { SlashKickCommand } from "./Kick.js";
import { SlashLuaCommand } from "./Lua.js";
import { SlashRconCommand } from "./Rcon.js";
import { SlashRefreshLuaCommand } from "./RefreshLua.js";
import { SlashUnBanCommand } from "./UnBan.js";

export const gmodSlashCommands = [
	SlashBanCommand,
	SlashGservCommand,
	SlashKickCommand,
	SlashLuaCommand,
	SlashRconCommand,
	SlashRefreshLuaCommand,
	SlashUnBanCommand,
];
