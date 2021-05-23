import { BaseCommand } from ".";
import { Command } from "detritus-client";
import { DiscordBot } from "..";

export class MarkovCommand extends BaseCommand {
	constructor(bot: DiscordBot) {
		super(bot, {
			name: "mk",
			metadata: {
				help: "Funny text generation",
				usage: ["!mk", `#MENTION mk`],
			},
		});
	}

	async run(ctx: Command.Context): Promise<void> {
		if (ctx.canDelete) {
			ctx.message.delete();
		}

		let content: string = this.bot.container.getService("Markov").generate();
		content = `${ctx.message.author.mention} ${content}`;
		if (ctx.canReply) {

			ctx.reply(content);
		} else {
			ctx.user.createMessage(content);
		}
	}
}
