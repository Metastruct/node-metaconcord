import * as config from "@/discord.config.json";
import * as moment from "moment";
import { Command, CommandOptions, Context, ParsedArgs } from "detritus-client/lib/command";
import { CommandClient } from "detritus-client";
import { Data } from "../../Data";
import { Permissions } from "detritus-client/lib/constants";

const unitSecondsMap = {
	second: 1,
	minute: 60,
	hour: 60 * 60,
	day: 60 * 60 * 24,
	week: 60 * 60 * 24 * 7,
	month: 60 * 60 * 24 * 30,
	year: 60 * 60 * 24 * 365,
};

async function checkUserId(ctx: Context, args: ParsedArgs): Promise<boolean> {
	let userId = args.userId;
	if (ctx.command.name == "whymute" && !userId) {
		userId = ctx.user.id;
	} else {
		userId = userId.match(/<@!?(\d+)>/)?.[1] || userId;
	}
	args.userId = userId;

	if (!/^\d+$/.test(userId)) {
		const content = `${ctx.user.mention}, invalid user!`;
		let msg;
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

export class MuteCommand extends Command {
	private data: Data;

	constructor(commandClient: CommandClient, data: Data) {
		super(commandClient, {
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
					"Mutes a member for a time. The `-for` argument is optional and can be omitted to specify an indeterminate period of time for which the person will be affected. The syntax for it is also quite lenient...",
				usage: [
					"!mute <UserID>",
					"!mute <UserID> -for 1 hour 30 minutes",
					"!mute <UserID> -reason bad -for 5 minutes",
					`#MENTION mute <UserID>`,
				],
			},
			permissions: [Permissions.MANAGE_ROLES],
			permissionsClient: [Permissions.MANAGE_ROLES],
		} as CommandOptions);

		this.data = data;

		commandClient.client.on("guildMemberAdd", ({ member }) => {
			if (this.data.muted[member.id]) member.addRole(config.modules.mute.roleId);
		});
		setInterval(async () => {
			let changes = false;
			for (const [userId, data] of Object.entries(this.data.muted)) {
				if (typeof data.until == "number" && data.until < Date.now()) {
					delete this.data.muted[userId];
					const member = await commandClient.client.rest.fetchGuildMember(
						config.guildId,
						userId
					);
					member.removeRole(config.modules.mute.roleId);
					changes = true;
				}
			}
			if (changes) this.data.save();
		}, 1000);
	}

	onBeforeRun = checkUserId;

	async run(ctx: Context, { userId, for: time, reason }: ParsedArgs): Promise<void> {
		// Calculate time if any is specified
		let until;
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

		if (!this.data.muted) this.data.muted = {};
		this.data.muted[userId] = { until, reason, muter: ctx.user.id };
		await this.data.save();

		const member = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
		member.addRole(config.modules.mute.roleId);

		const content =
			`${ctx.user.mention}, user ${member.mention} has been muted` +
			(until ? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*` : "") +
			(reason ? ` with reason:\n\n${reason}` : "") +
			`.`;
		if (ctx.canReply) {
			ctx.reply(content);
		} else {
			ctx.user.createMessage(content);
		}
		ctx.message.delete();
	}
}

export class UnmuteCommand extends Command {
	private data: Data;

	constructor(commandClient: CommandClient, data: Data) {
		super(commandClient, {
			name: "unmute",
			label: "userId",
			responseOptional: true,
			disableDm: true,
			metadata: {
				help: "Unmutes a member.",
				usage: ["!unmute <UserID>", `#MENTION unmute <UserID>`],
			},
			permissions: [Permissions.MANAGE_ROLES],
			permissionsClient: [Permissions.MANAGE_ROLES],
		} as CommandOptions);

		this.data = data;
	}

	onBeforeRun = checkUserId;

	async run(ctx: Context, { userId }: ParsedArgs): Promise<void> {
		if (!this.data.muted) this.data.muted = {};
		delete this.data.muted[userId];
		await this.data.save();

		const member = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
		member.removeRole(config.modules.mute.roleId);

		const content = `${ctx.user.mention}, user ${member.mention} has been unmuted.`;
		if (ctx.canReply) {
			ctx.reply(content);
		} else {
			ctx.user.createMessage(content);
		}
		ctx.message.delete();
	}
}

export class WhyMuteCommand extends Command {
	private data: Data;

	constructor(commandClient: CommandClient, data: Data) {
		super(commandClient, {
			name: "whymute",
			label: "userId",
			disableDm: true,
			metadata: {
				help: "Prints the reason of a member's muting.",
				usage: ["!whymute <UserID?>", `#MENTION whymute <UserID?>`],
			},
		} as CommandOptions);

		this.data = data;
	}

	onBeforeRun = checkUserId;

	async run(ctx: Context, { userId }: ParsedArgs): Promise<void> {
		if (this.data.muted[userId]) {
			const { until, reason, muter } = this.data.muted[userId];
			const mutedMember = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
			const muterMember = await ctx.rest.fetchGuildMember(ctx.guildId, muter);

			const content =
				`${ctx.user.mention}, ` +
				(ctx.user.id == userId
					? `you remain muted`
					: `user **${mutedMember.toString()}** (\`${mutedMember.id}\`) remains muted`) +
				(until
					? ` for *${moment.duration(moment(until).diff(moment())).humanize()}*`
					: "") +
				(muterMember ? ` by **${muterMember.toString()}** (\`${muterMember.id}\`)` : "") +
				(reason ? ` with reason:\n\n${reason}` : " without a reason") +
				`.`;
			if (ctx.canReply) {
				ctx.reply(content);
			} else {
				ctx.user.createMessage(content);
			}
			ctx.message.delete();
		}
	}
}
