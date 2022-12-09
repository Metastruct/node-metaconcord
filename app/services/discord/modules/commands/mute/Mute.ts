import {
	ApplicationCommandType,
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { AuditLogEvent, GuildMember, User } from "discord.js";
import { Data } from "@/app/services/Data";
import { DiscordBot } from "../../..";
import { EphemeralResponse } from "..";
import { TextChannel } from "discord.js";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";

const DEFAULT_MUTE_LENGTHS = ["1 day", "1 week", "4 weeks", "6 months", "1 year"];

const manualMuteReminderTimeouts: string[] = [];

export class SlashMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "mute",
			description: "Mutes an user.",
			guildIDs: [bot.config.guildId],
			requiredPermissions: ["MANAGE_ROLES"],
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
						"The amount of time you want to mute the user for. Input none for indefinite\nFor example: `2 weeks`",
					required: false,
					autocomplete: true,
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
		dayjs.extend(relativeTime);
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;

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
					type: AuditLogEvent.MemberRoleUpdate,
				});
				for (const [, entry] of auditLogs.entries) {
					const target = entry.target as User;
					const user = entry.executor;
					if (!user?.id) return;
					if (user?.id == user?.client?.user?.id) continue;
					if (target.id == member.id && !manualMuteReminderTimeouts.includes(user.id)) {
						const notificationsChannel = user?.client.channels.cache.get(
							config.notificationsChannelId
						) as TextChannel;
						notificationsChannel.send(
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
					const member = await guild?.members.fetch(userId);
					if (!member) return;
					member.roles.remove(config.mutedRoleId);
					changes = true;
				}
			}
			if (changes) this.data.save();
		}, 1000);
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[] | undefined> {
		switch (ctx.focused) {
			case "time":
				return DEFAULT_MUTE_LENGTHS.map(entry => {
					return { name: entry, value: entry } as AutocompleteChoice;
				});
			default:
				return undefined;
		}
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer();
		const { discord, config } = this.bot;
		let { muted } = this.data;
		const userId = ctx.options.user.toString();
		const time = ctx.options.time as string;
		const reason = ctx.options.reason as string;
		const now = Date.now();

		// Calculate time if any is specified
		let until = now;
		if (time) {
			const amount = time.substring(0, 1); // lol
			const unit = time.substring(2) as dayjs.ManipulateType;
			until += dayjs().add(Number(amount), unit).millisecond();
		}

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { at: now, until, reason, muter: ctx.user.id };
		await this.data.save();

		const guild = discord.guilds.cache.get(this.bot.config.guildId);
		if (!guild) return;
		let member: GuildMember;
		try {
			member = await guild.members.fetch(userId);
		} catch {
			return "Couldn't get that User, probably left the guild already...";
		}
		await member.roles.add(config.mutedRoleId, "muted via slash command");

		const content =
			`${ctx.user.mention}, ${member} has been muted` +
			(until ? ` for <t:${until}:R>` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		return content;
	}
}

// UI Commands
export class UIMuteCommand extends SlashCommand {
	private bot: DiscordBot;
	private data: Data;

	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "Mute User",
			type: ApplicationCommandType.USER,
			guildIDs: [bot.config.guildId],
			requiredPermissions: ["MANAGE_ROLES"],
		});

		this.filePath = __filename;
		this.bot = bot;
		const data = this.bot.container.getService("Data");
		if (!data) return;
		this.data = data;
	}

	async run(ctx: CommandContext): Promise<any> {
		await ctx.defer(true);
		const { discord, config } = this.bot;
		let { muted } = this.data;
		const userId = ctx.targetID;
		if (!userId) return;
		const now = Date.now();

		if (!muted) muted = this.data.muted = {};
		muted[userId] = { at: now, muter: ctx.user.id };
		await this.data.save();

		const guild = discord.guilds.cache.get(this.bot.config.guildId);
		if (!guild) return;
		let member: GuildMember;
		try {
			member = await guild.members.fetch(userId);
		} catch {
			return EphemeralResponse("Couldn't get that User, probably left the guild already...");
		}
		await member.roles.add(config.mutedRoleId, "muted via rightclick menu command");

		const content = `${member} has been muted.`;
		return EphemeralResponse(content);
	}
}
