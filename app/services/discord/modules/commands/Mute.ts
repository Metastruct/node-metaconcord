import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from ".";
import { MenuCommand, SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
dayjs.extend(relativeTime);

const manualMuteReminderTimeouts: string[] = [];
let dataProvider: Data;

export const SlashMuteCommand: SlashCommand = {
	options: {
		name: "mute",
		description: "Mutes an user.",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.User,
				name: "user",
				description: "The Discord user we want to mute",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "reason",
				description: "Why you want to mute the user.",
				required: true,
			},
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "time",
				description:
					"The amount of time you want to mute the user for. Input none for indefinite\nFor example: `2 weeks`",
				required: false,
			},
		],
	},

	async execute(ctx, bot) {
		await ctx.deferReply();
		const data = dataProvider;
		if (!data) {
			await ctx.followUp("DataProvider missing :(");
			return;
		}

		const { discord, config } = bot;
		let { muted } = data;
		const userId = ctx.options.getUser("user", true).id;
		const time = ctx.options.getString("time");
		const reason = ctx.options.getString("reason") ?? undefined;
		const now = Date.now();

		// Calculate time if any is specified
		let until = now;
		if (time) {
			const amount = time.substring(0, 1); // lol
			const unit = time.substring(2) as dayjs.ManipulateType;
			until += dayjs().add(Number(amount), unit).millisecond();
		}

		if (!muted) muted = data.muted = {};
		muted[userId] = { at: now, until, reason, muter: ctx.user.id };
		await data.save();

		const guild = discord.guilds.cache.get(bot.config.bot.primaryGuildId);
		if (!guild) return;
		const member = await bot.getGuildMember(userId);
		if (!member) {
			await ctx.followUp("Couldn't get that User, probably left the guild already...");
			return;
		}
		await member.roles.add(config.roles.muted, "muted via slash command");

		const content =
			`${ctx.user.mention}, ${member} has been muted` +
			(until ? ` for <t:${until}:R>` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		await ctx.followUp(content);
	},
	async initialize(bot: DiscordBot) {
		const { config } = bot;
		const client = bot.discord;
		const data = bot.container.getService("Data");
		if (!data) return;
		dataProvider = data;
		const { muted } = dataProvider;

		// Re-add muted role if user leaves and rejoins to try and escape it
		client.on("guildMemberAdd", async member => {
			if (muted[member.id]) await member.roles.add(config.roles.muted);
		});

		// Don't let anyone add muted people, and persist the role if someone tries to take it off
		client.on("guildMemberUpdate", async (_, member) => {
			// This is sort of really ugly... See who's trying to mess with the role and notify them
			const warn = async () => {
				const auditLogs = await member.guild.fetchAuditLogs({
					type: Discord.AuditLogEvent.MemberRoleUpdate,
				});
				for (const [, entry] of auditLogs.entries) {
					const target = entry.target as Discord.User;
					const user = entry.executor;
					if (!user?.id) return;
					if (user?.id == user?.client?.user?.id) continue;
					if (target.id == member.id && !manualMuteReminderTimeouts.includes(user.id)) {
						const notificationsChannel = bot.getTextChannel(
							config.channels.notifications
						);
						notificationsChannel?.send(
							`${user.mention}, this role can only be managed by me. Sorry! Use /mute, or rightclick an user > apps > mute.`
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

			if (member.roles.cache.has(config.roles.muted) && !muted[member.id]) {
				await member.roles.remove(config.roles.muted, "role was added manually");
				warn();
			}

			if (!member.roles.cache.has(config.roles.muted) && muted[member.id]) {
				await member.roles.add(config.roles.muted, "role was removed manually");
				warn();
			}
		});

		// Every second, check if mute period is over
		setInterval(async () => {
			let changes = false;
			for (const [userId, data] of Object.entries(muted)) {
				if (typeof data.until == "number" && data.until < Date.now()) {
					delete muted[userId];
					const member = await bot.getGuildMember(userId);
					if (!member) return;
					await member.roles.remove(config.roles.muted, "mute time expired");
					changes = true;
				}
			}
			if (changes) await data.save();
		}, 1000);
	},
};

export const MenuMuteCommand: MenuCommand = {
	options: {
		name: "Mute User",
		type: Discord.ApplicationCommandType.User,
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot: DiscordBot) => {
		await ctx.deferReply();
		const data = dataProvider;
		if (!data) {
			ctx.followUp(EphemeralResponse("DataProvider missing :("));
			return;
		}
		let { muted } = data;
		const userId = ctx.targetId;
		if (!userId) {
			ctx.followUp(EphemeralResponse("TargetId missing :( (blame me or discord)"));
			return;
		}
		const now = Date.now();

		if (!muted) muted = data.muted = {};
		muted[userId] = { at: now, muter: ctx.user.id };
		await data.save();

		const guild = bot.getGuild();
		if (!guild) return;
		const member = await bot.getGuildMember(userId);
		if (!member) {
			ctx.followUp(
				EphemeralResponse("Couldn't get that User, probably left the guild already...")
			);
			return;
		}
		await member.roles.add(bot.config.roles.muted, "muted via rightclick menu command");

		await ctx.followUp(`${member} has been muted.`);
	},
};

export const SlashUnMuteCommand: SlashCommand = {
	options: {
		name: "unmute",
		description: "Unmutes an user.",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.User,
				name: "user",
				description: "The Discord user we want to mute",
				required: true,
			},
		],
	},

	async execute(ctx, bot) {
		await ctx.deferReply();
		const data = dataProvider;
		if (!data) {
			await ctx.followUp("DataProvider missing :(");
			return;
		}
		const userId = ctx.options.getUser("user", true).id;

		const { config } = bot;
		let { muted } = data;

		if (!muted) muted = data.muted = {};
		delete muted[userId];
		await data.save();

		const guild = bot.getGuild();
		if (guild) {
			const member = await bot.getGuildMember(userId);
			if (!member) {
				ctx.followUp(
					EphemeralResponse("Couldn't get that User, probably left the guild already...")
				);
				return;
			}
			await member.roles.remove(
				config.roles.muted,
				`unmuted via slash command by <@${ctx.user.id}>`
			);
			await ctx.followUp(`${member.mention} has been unmuted by ${ctx.user.mention}.`);
		} else {
			await ctx.followUp(EphemeralResponse("how#3"));
		}
	},
};

export const MenuUnMuteCommand: MenuCommand = {
	options: {
		name: "Unmute User",
		type: Discord.ApplicationCommandType.User,
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot: DiscordBot) => {
		await ctx.deferReply();
		const data = dataProvider;
		if (!data) {
			ctx.followUp(EphemeralResponse("DataProvider missing :("));
			return;
		}

		const userId = ctx.targetId;
		if (!userId) return;

		const { config } = bot;
		let { muted } = data;

		if (!muted) muted = data.muted = {};
		delete muted[userId];
		await data.save();

		const guild = bot.getGuild();
		if (guild) {
			const member = await bot.getGuildMember(userId);
			if (!member) {
				ctx.followUp(
					EphemeralResponse("Couldn't get that User, probably left the guild already...")
				);
				return;
			}
			await member.roles.remove(
				config.roles.muted,
				`unmuted via rightclick menu command by <@${ctx.user.id}>`
			);
			await ctx.followUp(`${member} has been unmuted.`);
		} else {
			await ctx.followUp(EphemeralResponse("how#3"));
		}
	},
};

export const SlashWhyMuteCommand: SlashCommand = {
	options: {
		name: "whymute",
		description: "Prints the reason and duration for a muted user.",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.User,
				name: "user",
				description: "discord user for which we want the reason/duration of the mute",
			},
		],
	},

	async execute(ctx, bot) {
		await ctx.deferReply({ ephemeral: true });
		const data = dataProvider;
		if (!data) {
			await ctx.followUp("DataProvider missing :(");
			return;
		}
		const userId = ctx.options.getUser("user")?.id ?? ctx.user.id;
		const { muted } = data;
		if (muted && muted[userId]) {
			const { at, until, reason, muter } = muted[userId];
			const guild = bot.getGuild();
			if (guild) {
				const content =
					`${ctx.user.mention}, ` +
					(ctx.user.id == userId ? `you remain muted` : `<@${userId}> remains muted`) +
					(until ? ` expires <t:${until}:R> from now` : "") +
					(muter ? ` by <@${muter}>` : "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					(at ? `\n\nmuted since: <t:${at.toString().substring(0, 10)}:R>` : "") +
					`.`;
				await ctx.followUp(EphemeralResponse(content));
			} else {
				await ctx.followUp(EphemeralResponse("how#3"));
			}
		} else {
			await ctx.followUp(
				EphemeralResponse(
					userId == ctx.user.id
						? "You're not muted... yet!"
						: "That user hasn't been muted... yet!"
				)
			);
		}
	},
};

export const MenuWhyMuteCommand: MenuCommand = {
	options: {
		name: "Mute Reason",
		type: Discord.ApplicationCommandType.User,
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageRoles.toString(),
	},
	execute: async (ctx: Discord.MessageContextMenuCommandInteraction, bot: DiscordBot) => {
		await ctx.deferReply({ ephemeral: true });
		const data = dataProvider;
		if (!data) {
			await ctx.followUp("DataProvider missing :(");
			return;
		}
		const userId = ctx.targetId ?? ctx.user.id;
		const { muted } = data;
		if (muted && muted[userId]) {
			const { at, until, reason, muter } = muted[userId];
			const guild = bot.getGuild();
			if (guild) {
				const content =
					`${ctx.user.mention}, ` +
					(ctx.user.id == userId ? `you remain muted` : `<@${userId}> remains muted`) +
					(until ? ` expires <t:${until}:R> from now` : "") +
					(muter ? ` by <@${muter}>` : "") +
					(reason ? ` with reason:\n\n${reason}` : " without a reason") +
					(at ? `\n\nmuted since: <t:${at.toString().substring(0, 10)}:R>` : "") +
					`.`;
				await ctx.followUp(EphemeralResponse(content));
			} else {
				await ctx.followUp(EphemeralResponse("how#3"));
			}
		} else {
			await ctx.followUp(
				EphemeralResponse(
					userId == ctx.user.id
						? "You're not muted... yet!"
						: "That user hasn't been muted... yet!"
				)
			);
		}
	},
};
