import {
	CommandContext,
	CommandOptionType,
	Context,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "..";
import Discord from "discord.js";

export class SlashCustomRoleCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "role",
			description: "Gives you a Custom Role.",
			deferEphemeral: true,
			guildIDs: [bot.config.guildId],
			options: [
				{
					type: CommandOptionType.STRING,
					name: "name",
					description: "the name of your role",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "colour",
					description: "the colour of your role",
				},
			],
		});
		this.filePath = __filename;
		this.bot = bot;
	}

	async run(ctx: CommandContext): Promise<any> {
		const rolename = ctx.options.name;
		const colour = ctx.options?.colour;
		ctx.send("not done yet", { ephemeral: true });
	}
}
