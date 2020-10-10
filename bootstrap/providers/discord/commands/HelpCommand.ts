import { Command, CommandOptions, Context, ParsedArgs } from "detritus-client/lib/command";
import { CommandClient, ShardClient } from "detritus-client";
import { Permissions } from "detritus-client/lib/constants";

export class HelpCommand extends Command {
	constructor(commandClient: CommandClient) {
		super(commandClient, {
			name: "help",
			metadata: {
				help: "Displays this message.",
				usage: ["!help", `#MENTION help`],
			},
		} as CommandOptions);
	}

	async run(ctx: Context): Promise<void> {
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
					content +=
						line.replace(
							"#MENTION",
							(ctx.commandClient.client as ShardClient).user.mention
						) + "\n";
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
