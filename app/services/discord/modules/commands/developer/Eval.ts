import { CommandContext, CommandOptionType, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { SlashDeveloperCommand } from "./DeveloperCommand";
import ts from "typescript";
import tsconfig from "@/tsconfig.json";

export class SlashEvalCommand extends SlashDeveloperCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "eval",
			description: "Executes javascript or typescript on the bot",
			options: [
				{
					type: CommandOptionType.STRING,
					name: "code",
					description: "The javascript or typescript code to execute",
					required: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		if (!this.isElevated(ctx.user))
			return EphemeralResponse(
				`You need the <#${this.bot.config.roles.elevated}> to run this command!`
			);
		const lang = (ctx.options.code as string).substring(0, 2);
		if (lang !== "js" && lang !== "ts") return EphemeralResponse("unsupported langauge");
		const code = (ctx.options.code as string).substring(3);
		switch (lang) {
			case "js":
				try {
					let res = "";
					res = (1, eval)(code);
					return `\`\`\`js\n${res}\`\`\``;
				} catch (err) {
					return `\`\`\`js\n${err}\`\`\``;
				}
			case "ts": {
				try {
					const js = ts.transpile(
						code,
						ts.parseJsonConfigFileContent(tsconfig, ts.sys, process.cwd()).options
					);
					const res = (1, eval)(js);
					return `\`\`\`js\n${res}\`\`\``;
				} catch (err) {
					return `\`\`\`js\n${err}\`\`\``;
				}
			}
		}
	}
}
