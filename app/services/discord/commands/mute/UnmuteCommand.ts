import { CommandContext, CommandOptionType, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "../..";

export class SlashUnmuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "unmute",
			description:
				"Prints the reason of a member's muting. You can omit the argument to check your own details, if any.",
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description: "The discord user to unmute",
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	//onBeforeRun = onBeforeRun;

	async run(ctx: CommandContext): Promise<string> {
		const userId = ctx.options.user.toString();
		const data = this.bot.container.getService("Data");

		const { config } = this.bot;
		let { muted } = data;

		if (!muted) muted = data.muted = {};
		delete muted[userId];
		await data.save();

		const guild = await this.bot.discord.guilds.resolve(ctx.guildID)?.fetch();
		if (guild) {
			const member = await guild.members.resolve(userId)?.fetch();
			if (!member) return "invalid user";

			await member.roles.remove(config.modules.mute.roleId);
			return `${ctx.user.mention}, user <@${member.id}> has been unmuted.`;
		} else {
			return "not in a guild";
		}
	}
}
