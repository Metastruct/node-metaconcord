import CommandsLoader from "./commands";
import DiscordEventsLoader from "./discord-events";
import DiscordGuildIconLoader from "./discord-guild-icon";
import LoggingLoader from "./logging";
import MotdRollbackLoader from "./motdrollback";
import ProgressBarLoader from "./premium-progress-bar";
import ShitpostLoader from "./shitposting";
import StarboardLoader from "./starboard";
import TempVoiceChannelsLoader from "./temp-voice-channels";

export default [
	CommandsLoader,
	DiscordGuildIconLoader,
	DiscordEventsLoader,
	LoggingLoader,
	MotdRollbackLoader,
	ProgressBarLoader,
	ShitpostLoader,
	StarboardLoader,
	TempVoiceChannelsLoader,
];
