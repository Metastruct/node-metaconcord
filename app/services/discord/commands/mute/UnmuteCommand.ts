import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";
import { onBeforeRun } from "./MuteCommand";

export class SlashUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "whymute",
			description:
				"Prints the reason of a member's muting. You can omit the argument to check your own details, if any.",
			options: [
				{
					type: CommandOptionType.STRING,
					name: "userId",
					description: "The discord id for the user",
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	onBeforeRun = onBeforeRun;

	async run(ctx: CommandContext): Promise<string> {
		const userId = ctx.options.userId.toString();
		const data = this.bot.container.getService("Data");

		const { config } = this.bot;
		let { muted } = data;

		if (!muted) muted = data.muted = {};
		delete muted[userId];
		await data.save();

		const member = await this.bot.discord.rest.fetchGuildMember(config.guildId, userId);
		await member.removeRole(config.modules.mute.roleId);

		return `${ctx.user.mention}, user ${member.mention} has been unmuted.`;
	}
}
