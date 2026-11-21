import accountsAPI from "./accounts.ts";
import addAddonsAPI from "./addons.ts";
import appealsAPI from "./appeals.ts";
import discordOAuth from "./auth/discord.ts";
import githubAuth from "./auth/github.ts";
import gitlabAuth from "./auth/gitlab.ts";
import session from "./auth/session.ts";
import steamAuth from "./auth/steam.ts";
import bansAPI from "./bans.ts";
import ci from "./ci.ts";
import consoleAPI from "./console.ts";
import dashboard from "./dashboard.ts";
import discordEvents from "./discord-events.ts";
import discordWidget from "./discord-widget.ts";
import addEmojiAPI from "./emojis.ts";
import addGameServerStatusAPI from "./game-server-status.ts";
import changeGamemode from "./gamemode.ts";
import gmodErrorHandler from "./gmod-error-handler.ts";
import history from "./history.ts";
import redirects from "./redirects.ts";
import addMapThumbnails from "./resources.ts";
import robots from "./robots.ts";
import servers from "./servers.ts";

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
