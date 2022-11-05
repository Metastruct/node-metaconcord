import addEmojiAPI from "./emojis";
import addGameServerStatusAPI from "./game-server-status";
import addMapThumbnails from "./map-thumbnails";
import changeGamemode from "./gamemode";
import ci from "./ci";
import gmodErrorHandler from "./gmod-error-handler";
import webhookHandler from "./webhook-handler";

export default [
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	changeGamemode,
	ci,
	gmodErrorHandler,
	webhookHandler,
];
