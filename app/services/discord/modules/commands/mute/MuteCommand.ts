import {
	ApplicationCommandPermissionType,
	ApplicationCommandType,
	CommandContext,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";
import { GuildAuditLogs, User } from "discord.js";
import { TextChannel } from "discord.js";
import moment from "moment";

const manualMuteReminderTimeouts: string[] = [];

export class SlashMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mute",
			description: "Mutes an user.",
			type: ApplicationCommandType.USER,
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
		});

		this.filePath = __filename;
		this.bot = bot;
		this.data = this.bot.container.getService("Data");

		const { config } = this.bot,
			client = this.bot.discord,
			{ muted } = this.data;

		// Re-add muted role if user leaves and rejoins to try and escape it
		client.on("guildMemberAdd", async member => {
			if (muted[member.id]) await member.roles.add(config.mutedRoleId);
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
							`${user.mention}, this role can only be managed by me. Sorry!`
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

			if (member.roles.cache.has(config.mutedRoleId) && !muted[member.id]) {
				await member.roles.remove(config.mutedRoleId);
				warn();
			}

			if (!member.roles.cache.has(config.mutedRoleId) && muted[member.id]) {
				await member.roles.add(config.mutedRoleId);
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
					member.roles.remove(config.mutedRoleId);
					changes = true;
				}
			}
			if (changes) this.data.save();
		}, 1000);
	}

	async run(ctx: CommandContext): Promise<any> {
		const { discord, config } = this.bot;
		let { muted } = this.data;
		const userId = ctx.targetID;

		const until = undefined; // pog, always undefined
		const reason = undefined; // we could add a callback and check for last msg but dunno man

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { until, reason, muter: ctx.user.id };
		await this.data.save();

		const guild = await discord.guilds.fetch(this.bot.config.guildId);
		const member = await guild.members.fetch(userId);
		await member.roles.add(config.mutedRoleId, "muted via rightclick menu command");

		const content =
			`${member.mention} has been muted` +
			(until ? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		return EphemeralResponse(content);
	}
}
