import addEmojiAPI from "./emojis.js";
import addGameServerStatusAPI from "./game-server-status.js";
import addMapThumbnails from "./resources.js";
import changeGamemode from "./gamemode.js";
import ci from "./ci.js";
import discordOAuth from "./discord-oauth.js";
import gmodErrorHandler from "./gmod-error-handler.js";
import steamOAuth from "./steam-oauth.js";

export default [
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	changeGamemode,
	ci,
	discordOAuth,
	gmodErrorHandler,
	steamOAuth,
];
