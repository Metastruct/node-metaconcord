import accountsAPI from "./accounts.js";
import addAddonsAPI from "./addons.js";
import appealsAPI from "./appeals.js";
import discordOAuth from "./auth/discord.js";
import githubAuth from "./auth/github.js";
import gitlabAuth from "./auth/gitlab.js";
import session from "./auth/session.js";
import steamAuth from "./auth/steam.js";
import bansAPI from "./bans.js";
import ci from "./ci.js";
import consoleAPI from "./console.js";
import dashboard from "./dashboard.js";
import discordEvents from "./discord-events.js";
import discordWidget from "./discord-widget.js";
import addEmojiAPI from "./emojis.js";
import addGameServerStatusAPI from "./game-server-status.js";
import changeGamemode from "./gamemode.js";
import gmodErrorHandler from "./gmod-error-handler.js";
import history from "./history.js";
import redirects from "./redirects.js";
import addMapThumbnails from "./resources.js";
import robots from "./robots.js";
import servers from "./servers.js";

export default [
	accountsAPI,
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
	gitlabAuth,
	session,
	gmodErrorHandler,
	history,
	redirects,
	robots,
	servers,
	steamAuth,
];
