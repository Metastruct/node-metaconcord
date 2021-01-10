import { BaseCommand } from ".";
import { Command } from "detritus-client";
import { DiscordBot } from "..";
import { Permissions } from "detritus-client/lib/constants";

export class HelpCommand extends BaseCommand {
	constructor(bot: DiscordBot) {
		super(bot, {
			name: "help",
			metadata: {
				help: "Displays this message.",
				usage: ["!help", `#MENTION help`],
			},
		});
	}

	async run(ctx: Command.Context): Promise<void> {
		let content = `**Help is on the way!**\n\n`;
		for (const command of ctx.commandClient.commands) {
			if (command?.permissions) {
				let show = true;
				for (const permission of command.permissions) {
					if (!ctx.member.can(permission)) show = false;
					break;
				}
				if (!show) continue;
			}

			content += `**${ctx.commandClient.prefixes.custom.values().next().value}${
				command.name
			}** - ${command?.metadata.help ?? "No help provided."}\n`;

			if (command?.metadata.usage && command.metadata.usage.length > 0) {
				content += `__Usage:__\`\`\`\n`;
				for (const line of command.metadata.usage) {
					content += line.replace("#MENTION", ctx.client.user.mention) + "\n";
				}
				content += `\`\`\``;
			}

			if (command?.permissions) {
				content += `__Required permissions:__ `;
				const permissionNames = [];
				for (const permission of command.permissions) {
					permissionNames.push(`\`${Permissions[permission]}\``);
				}
				content += permissionNames.join(", ") + "\n";
			}

			content += "\n";
		}

		if (ctx.canReply) {
			ctx.reply(content);
		} else {
			ctx.user.createMessage(content);
		}
	}
}
