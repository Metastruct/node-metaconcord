import addEmojiAPI from "./emojis";
import addGameServerStatusAPI from "./game-server-status";
import addMapThumbnails from "./map-thumbnails";
import changeGamemode from "./gamemode";
import ci from "./ci";
import errorHandler from "./errorhandler";

export default [
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	changeGamemode,
	ci,
	errorHandler,
];
