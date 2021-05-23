import { AuditLogActions, Permissions } from "detritus-client/lib/constants";
import { BaseCommand } from "..";
import { Command } from "detritus-client";
import { DiscordBot } from "../..";
import { Message } from "detritus-client/lib/structures";
import { SlashCommand, SlashCreator } from "slash-create";
import moment from "moment";

/*const unitSecondsMap = {
	second: 1,
	minute: 60,
	hour: 60 * 60,
	day: 60 * 60 * 24,
	week: 60 * 60 * 24 * 7,
	month: 60 * 60 * 24 * 30,
	year: 60 * 60 * 24 * 365,
};

export async function onBeforeRun(
	ctx: Command.Context,
	args: Command.ParsedArgs
): Promise<boolean> {
	let userId = args.userId;
	if (ctx.command.name == "whymute" && !userId) {
		userId = ctx.user.id;
	} else {
		userId = (userId || "").match(/<@!?(\d+)>/)?.[1] || userId;
	}
	args.userId = userId;

	if (!/^\d+$/.test(userId)) {
		const content = `${ctx.user.mention}, invalid user!`;
		let msg: Message;
		if (ctx.canReply) {
			msg = await ctx.reply(content);
		} else {
			msg = await ctx.user.createMessage(content);
		}
		if (msg) {
			setTimeout(() => {
				msg.delete();
			}, 5000);
		}
		return false;
	} else {
		return true;
	}
}

const manualMuteReminderTimeouts: string[] = [];
export default class MuteCommand extends BaseCommand {
	constructor(bot: DiscordBot) {
		super(bot, {
			name: "mute",
			label: "userId",
			responseOptional: true,
			disableDm: true,
			args: [
				{
					name: "for",
					type: "string",
				},
				{
					name: "reason",
					type: "string",
				},
			],
			metadata: {
				help:
					"Mutes a member for an optional reason and amount of time.\n" +
					"The `-for` argument is optional and can be omitted to specify an indeterminate period of time for which the person will be affected.\n" +
					"The syntax for it is also quite lenient...",
				usage: [
					"!mute <Mention/UserID>",
					"!mute <Mention/UserID> -for 1 hour 30 minutes",
					"!mute <Mention/UserID> -reason bad -for 5 minutes",
					`#MENTION mute <Mention/UserID>`,
				],
			},
			permissions: [Permissions.MANAGE_ROLES],
			permissionsClient: [Permissions.MANAGE_ROLES],
		});

		const { config } = this.bot,
			{ client } = this.bot.discord,
			{ muted } = this.data;

		// Re-add muted role if user leaves and rejoins to try and escape it
		client.on("guildMemberAdd", async ({ member }) => {
			if (muted[member.id]) await member.addRole(config.modules.mute.roleId);
		});

		// Don't let anyone add muted people, and persist the role if someone tries to take it off
		client.on("guildMemberUpdate", async ({ member }) => {
			// This might be redundant but I just saw a role ID being null for some reason
			member = await client.rest.fetchGuildMember(member.guildId, member.id);

			// This is sort of really ugly... See who's trying to mess with the role and notify them
			const warn = async () => {
				const auditLogs = await member.guild.fetchAuditLogs({
					actionType: AuditLogActions.MEMBER_ROLE_UPDATE,
				});
				for (const { target, user } of Object.values(auditLogs)) {
					if (user.id == user.client.user.id) continue;
					if (target.id == member.id && !manualMuteReminderTimeouts.includes(user.id)) {
						const notificationsChannel = await user.client.rest.fetchChannel(
							config.notificationsChannelId
						);
						notificationsChannel.createMessage(
							`${user.mention}, this role can only be managed with me. Sorry!\nYou can ask for \`!help\` in the chat for more information.`
						);

						manualMuteReminderTimeouts.push(user.id);
						setTimeout(() => {
							delete manualMuteReminderTimeouts[
								manualMuteReminderTimeouts.findIndex(id => id == user.id)
							];
						}, 30 * 1000);

						break;
					}
				}
			};

			if (
				member.roles.find(role => role.id == config.modules.mute.roleId) &&
				!muted[member.id]
			) {
				await member.removeRole(config.modules.mute.roleId);
				warn();
			}

			if (
				!member.roles.find(role => role.id == config.modules.mute.roleId) &&
				muted[member.id]
			) {
				await member.addRole(config.modules.mute.roleId);
				warn();
			}
		});

		// Every second, check if mute period is over
		setInterval(async () => {
			let changes = false;
			for (const [userId, data] of Object.entries(muted)) {
				if (typeof data.until == "number" && data.until < Date.now()) {
					delete muted[userId];
					const member = await bot.discord.rest.fetchGuildMember(config.guildId, userId);
					member.removeRole(config.modules.mute.roleId);
					changes = true;
				}
			}
			if (changes) this.data.save();
		}, 1000);
	}

	onBeforeRun = onBeforeRun;

	async run(
		ctx: Command.Context,
		{ userId, for: time, reason }: Command.ParsedArgs
	): Promise<void> {
		const { config } = this.bot;
		let { muted } = this.data;

		// Calculate time if any is specified
		let until: number;
		if (time) {
			for (const {
				groups: { amount, unit },
			} of time.matchAll(
				/(?<amount>\d+)\s*(?<unit>year|month|week|day|hour|minute|second)/gi
			)) {
				if (!until) until = Date.now();
				until += amount * unitSecondsMap[unit] * 1000;
			}
		}

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { until, reason, muter: ctx.user.id };
		await this.data.save();

		const member = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
		await member.addRole(config.modules.mute.roleId);

		const content =
			`${ctx.user.mention}, user ${member.mention} has been muted` +
			(until ? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		const mutedChannel = await ctx.rest.fetchChannel(config.mutedChannelId);
		mutedChannel.createMessage(content);
		ctx.message.delete();
	}
}*/

export class SlashMuteCommand extends SlashCommand {
	constructor(creator: SlashCreator) {
		super(creator, {
			name: "mute",
			description: "Mutes a member.",
		});
		this.filePath = __filename;
	}
}
