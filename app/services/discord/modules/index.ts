import CommandsLoader from "./commands/index.js";
import DiscordEventsLoader from "./discord-events.js";
import DiscordGuildIconLoader from "./discord-guild-icon.js";
import LoggingLoader from "./logging.js";
//import MotdRollbackLoader from "./iotdrollback.js";
import PermaRolesLoader from "./perma-roles.js";
import ProgressBarLoader from "./premium-progress-bar.js";
import ShitpostLoader from "./shitposting.js";
import StarboardLoader from "./starboard.js";
import TempVoiceChannelsLoader from "./temp-voice-channels.js";
import WebhookHandlerLoader from "./webhook-handler.js";

export default [
	CommandsLoader,
	DiscordEventsLoader,
	DiscordGuildIconLoader,
	LoggingLoader,
	//	MotdRollbackLoader,
	PermaRolesLoader,
	ProgressBarLoader,
	ShitpostLoader,
	StarboardLoader,
	TempVoiceChannelsLoader,
	WebhookHandlerLoader,
];
