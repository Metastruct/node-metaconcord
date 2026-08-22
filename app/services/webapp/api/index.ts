import addAddonsAPI from "./addons.js";
import addEmojiAPI from "./emojis.js";
import addGameServerStatusAPI from "./game-server-status.js";
import addMapThumbnails from "./resources.js";
import changeGamemode from "./gamemode.js";
import ci from "./ci.js";
import consoleAPI from "./console.js";
import dashboard from "./dashboard.js";
import discordEvents from "./discord-events.js";
import discordOAuth from "./discord-oauth.js";
import discordWidget from "./discord-widget.js";
import githubAuth from "./github-auth.js";
import gmodErrorHandler from "./gmod-error-handler.js";
import history from "./history.js";
import redirects from "./redirects.js";
import servers from "./servers.js";
import steamOAuth from "./steam-oauth.js";

export default [
	addAddonsAPI,
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	changeGamemode,
	ci,
	consoleAPI,
	dashboard,
	discordEvents,
	discordOAuth,
	discordWidget,
	githubAuth,
	gmodErrorHandler,
	history,
	redirects,
	servers,
	steamOAuth,
];
