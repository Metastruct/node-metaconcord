import {
	ApplicationCommandOptionChoice,
	ChannelType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { InviteTargetType } from "discord.js/typings/enums";
import Discord from "discord.js";

const ActivitiyChoices: ApplicationCommandOptionChoice[] = [
	{ name: "Poker Night", value: "755827207812677713" },
	{ name: "Betrayal.io", value: "773336526917861400" },
	{ name: "Fishington", value: "814288819477020702" },
	{ name: "Chess in the Park", value: "832012774040141894" },
	{ name: "Checkers in the Park", value: "832013003968348200" },
	{ name: "Watch Together", value: "880218394199220334" },
	{ name: "Doodle Crew", value: "878067389634314250" },
	{ name: "Letter League", value: "879863686565621790" },
	{ name: "Word Snacks", value: "879863976006127627" },
	{ name: "Sketch Heads", value: "902271654783242291" },
	{ name: "SpellCast", value: "852509694341283871" },
];

export class SlashActivitiesCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "activities",
			description: "🤔",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.CHANNEL,
					name: "channel",
					description: "where I should invite you to",
					channel_types: [ChannelType.GUILD_VOICE],
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "activity",
					description: "the activity you want to start",
					required: true,
					choices: ActivitiyChoices,
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const channel = this.bot.discord.channels.cache.get(
			ctx.options.channel
		) as Discord.VoiceChannel;
		if (!channel) {
			return { content: "could not fetch the channel, sorry...", ephemeral: true };
		}
		const invite = await channel.createInvite({
			targetType: InviteTargetType.EMBEDDED_APPLICATION,
			targetApplication: ctx.options.activity,
		});
		if (!invite) {
			return { content: "could generate the invite, sorry...", ephemeral: true };
		}
		return { content: invite.url, ephemeral: true };
	}
}
