import ChannelTrimmerLoader from "./channel-trimmer.ts";
import ComboBreakerLoader from "./combo-breaker.ts";
import CommandsLoader from "./commands/index.ts";
import DiscordEventsLoader from "./discord-events.ts";
import DiscordGuildIconLoader from "./discord-guild-icon.ts";
import LoggingLoader from "./logging.ts";
//import MotdRollbackLoader from "./iotdrollback.ts";
import PermaRolesLoader from "./perma-roles.ts";
import ProgressBarLoader from "./premium-progress-bar.ts";
import ShitpostLoader from "./shitposting.ts";
import StarboardLoader from "./starboard.ts";
import TempVoiceChannelsLoader from "./temp-voice-channels.ts";
import WebhookHandlerLoader from "./webhook-handler.ts";

export default [
	ComboBreakerLoader,
	ChannelTrimmerLoader,
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
