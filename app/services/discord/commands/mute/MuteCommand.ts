import {
	ApplicationCommandPermissionType,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../..";
import { GuildAuditLogs, User } from "discord.js";
import { TextChannel } from "discord.js";
import moment from "moment";

const unitSecondsMap = {
	second: 1,
	minute: 60,
	hour: 60 * 60,
	day: 60 * 60 * 24,
	week: 60 * 60 * 24 * 7,
	month: 60 * 60 * 24 * 30,
	year: 60 * 60 * 24 * 365,
};

// export async function onBeforeRun(
// 	ctx: Command.Context,
// 	args: Command.ParsedArgs
// ): Promise<boolean> {
// 	let userId = args.userId;
// 	if (ctx.command.name == "whymute" && !userId) {
// 		userId = ctx.user.id;
// 	} else {
// 		userId = (userId || "").match(/<@!?(\d+)>/)?.[1] || userId;
// 	}
// 	args.userId = userId;

// 	if (!/^\d+$/.test(userId)) {
// 		const content = `${ctx.user.mention}, invalid user!`;
// 		let msg: Message;
// 		if (ctx.canReply) {
// 			msg = await ctx.reply(content);
// 		} else {
// 			msg = await ctx.user.createMessage(content);
// 		}
// 		if (msg) {
// 			setTimeout(() => {
// 				msg.delete();
// 			}, 5000);
// 		}
// 		return false;
// 	} else {
// 		return true;
// 	}
// }

const manualMuteReminderTimeouts: string[] = [];

export class SlashMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mute",
			description: "Mutes a member.",
			guildIDs: [bot.config.guildId],
			defaultPermission: false,
			permissions: {
				[bot.config.guildId]: [
					{
						type: ApplicationCommandPermissionType.ROLE,
						id: bot.config.developerRoleId,
						permission: true,
					},
				],
			},
			options: [
				{
					type: CommandOptionType.USER,
					name: "user",
					description: "The Discord user we want to mute",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "reason",
					description: "Why you want to mute the user.",
					required: true,
				},
				{
					type: CommandOptionType.STRING,
					name: "time",
					description:
						"The amount of time you want to mute the user for. Input none for indefinite",
					required: false,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
		this.data = this.bot.container.getService("Data");

		const { config } = this.bot,
			client = this.bot.discord,
			{ muted } = this.data;

		// Re-add muted role if user leaves and rejoins to try and escape it
		client.on("guildMemberAdd", async member => {
			if (muted[member.id]) await member.roles.add(config.modules.mute.roleId);
		});

		// Don't let anyone add muted people, and persist the role if someone tries to take it off
		client.on("guildMemberUpdate", async (_, member) => {
			// This is sort of really ugly... See who's trying to mess with the role and notify them
			const warn = async () => {
				const auditLogs = await member.guild.fetchAuditLogs({
					type: GuildAuditLogs.Actions.MEMBER_ROLE_UPDATE,
				});
				for (const [, entry] of auditLogs.entries) {
					const target = entry.target as User;
					const user = entry.executor;
					if (user.id == user.client.user.id) continue;
					if (target.id == member.id && !manualMuteReminderTimeouts.includes(user.id)) {
						const notificationsChannel = (await user.client.channels.fetch(
							config.notificationsChannelId
						)) as TextChannel;
						notificationsChannel.send(
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

			if (member.roles.cache.has(config.modules.mute.roleId) && !muted[member.id]) {
				await member.roles.remove(config.modules.mute.roleId);
				warn();
			}

			if (!member.roles.cache.has(config.modules.mute.roleId) && muted[member.id]) {
				await member.roles.add(config.modules.mute.roleId);
				warn();
			}
		});

		// Every second, check if mute period is over
		const guild = bot.discord.guilds.resolve(bot.config.guildId);
		setInterval(async () => {
			let changes = false;
			for (const [userId, data] of Object.entries(muted)) {
				if (typeof data.until == "number" && data.until < Date.now()) {
					delete muted[userId];
					const member = await guild.members.fetch(userId);
					member.roles.remove(config.modules.mute.roleId);
					changes = true;
				}
			}
			if (changes) this.data.save();
		}, 1000);
	}

	async run(ctx: CommandContext): Promise<any> {
		const { discord, config } = this.bot;
		let { muted } = this.data;
		const userId = ctx.options.user.toString();
		const time = ctx.options.time as string;
		const reason = ctx.options.reason as string;

		// Calculate time if any is specified
		let until: number;
		if (time) {
			for (const {
				groups: { amount, unit },
			} of time.matchAll(
				/(?<amount>\d+)\s*(?<unit>year|month|week|day|hour|minute|second)/gi
			)) {
				if (!until) until = Date.now();
				until += +amount * unitSecondsMap[unit] * 1000;
			}
		}

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { until, reason, muter: ctx.user.id };
		await this.data.save();

		const guild = discord.guilds.resolve(this.bot.config.guildId);
		const member = await guild.members.fetch(userId);
		await member.roles.add(config.modules.mute.roleId);

		const content =
			`${ctx.user.mention}, user ${member.mention} has been muted` +
			(until ? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		return content;
	}
}
