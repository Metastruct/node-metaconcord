import { ApplicationCommandType, CommandContext, SlashCommand, SlashCreator } from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { GuildMember } from "discord.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

export class UIWhyMuteCommand extends SlashCommand {
	private bot: DiscordBot;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Mute Reason",
			description: "Prints the reason and duration for a muted user.",
			guildIDs: [bot.config.guildId],
			type: ApplicationCommandType.USER,
		});

		this.filePath = __filename;
		this.bot = bot;
		dayjs.extend(relativeTime);
	}

	async run(ctx: CommandContext): Promise<any> {
		const userId = (ctx.targetID ?? ctx.user.id).toString();
		const { muted } = this.bot.container.getService("Data");
		if (muted && muted[userId]) {
			const { until, reason, muter } = muted[userId];
			const guild = this.bot.discord.guilds.cache.get(ctx.guildID);
			if (guild) {
				let mutedMember: GuildMember;
				let muterMember: GuildMember;
				try {
					mutedMember = await guild.members.fetch(userId);
					muterMember = await guild.members.fetch(muter);
				} catch {
					return EphemeralResponse(
						"Couldn't get that User, probably left the guild already..."
					);
				}

				const content =
					`${ctx.user.mention}, ` +
					(ctx.user.id == userId
						? `you remain muted`
						: `user **${mutedMember.toString()}** (\`${
								mutedMember.id
						  }\`) remains muted`) +
					(until ? ` for *${dayjs(until).fromNow()}*` : "") +
					(muterMember
						? ` by **${muterMember.toString()}** (\`${muterMember.id}\`)`
						: "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					`.`;
				return EphemeralResponse(content);
			} else {
				return EphemeralResponse("how#3");
			}
		} else {
			if (userId == ctx.user.id) {
				return EphemeralResponse("You're not muted... yet!");
			} else {
				return EphemeralResponse("That user hasn't been muted... yet!");
			}
		}
	}
}
