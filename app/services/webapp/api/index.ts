import addCI from "./ci";
import addChangeGamemode from "./gamemode";
import addEmojiAPI from "./emojis";
import addGameServerStatusAPI from "./game-server-status";
import addMapThumbnails from "./map-thumbnails";
import addNuxt from "./nuxt";
import addSteamfriendsGraphAPI from "./steamfriends-graph";

export default [
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	addChangeGamemode,
	addCI,
	addSteamfriendsGraphAPI,
	addNuxt, // Keep this at last
];
