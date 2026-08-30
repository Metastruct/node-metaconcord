import addAddonsAPI from "./addons.js";
import addEmojiAPI from "./emojis.js";
import addGameServerStatusAPI from "./game-server-status.js";
import addMapThumbnails from "./resources.js";
import appealsAPI from "./appeals.js";
import changeGamemode from "./gamemode.js";
import bansAPI from "./bans.js";
import ci from "./ci.js";
import consoleAPI from "./console.js";
import dashboard from "./dashboard.js";
import discordEvents from "./discord-events.js";
import discordOAuth from "./auth/discord.js";
import discordWidget from "./discord-widget.js";
import githubAuth from "./auth/github.js";
import gmodErrorHandler from "./gmod-error-handler.js";
import history from "./history.js";
import redirects from "./redirects.js";
import robots from "./robots.js";
import servers from "./servers.js";
import steamAuth from "./auth/steam.js";

export default [
	addAddonsAPI,
	addEmojiAPI,
	addGameServerStatusAPI,
	addMapThumbnails,
	appealsAPI,
	bansAPI,
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
	robots,
	servers,
	steamAuth,
];
