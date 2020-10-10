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

export class MuteCommand extends Command {
	private data: Data;

	constructor(commandClient: CommandClient, data: Data) {
		super(commandClient, {
			name: "mute",
			responseOptional: true,
			disableDm: true,
			args: [
				{
					name: "for",
					type: "string",
				},
			],
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

	onBefore(ctx: Context): boolean {
		return ctx.member.can(Permissions.MANAGE_ROLES);
	}

	async run(ctx: Context, { mute: userId, for: time }: ParsedArgs): Promise<void> {
		// Find user ID from mention
		userId = userId.match(/<@!?(\d+)>/)?.[1] || userId;

		// Calculate time if any is specified
		let unmuteTime = null;
		if (time) {
			for (const {
				groups: { amount, unit },
			} of time.matchAll(
				/(?<amount>\d+)\s*(?<unit>year|month|week|day|hour|minute|second)/gi
			)) {
				if (!unmuteTime) unmuteTime = Date.now();
				unmuteTime += amount * unitSecondsMap[unit] * 1000;
			}
		}

		if (/^\d+$/.test(userId)) {
			if (!this.data.muted) this.data.muted = {};
			this.data.muted[userId] = { until: unmuteTime };
			await this.data.save();

			const member = await ctx.rest.fetchGuildMember(ctx.guildId, userId);
			member.addRole(config.modules.mute.roleId);

			const content =
				`${ctx.user.mention}, user ${member.mention} has been muted` +
				(unmuteTime
					? ` for ${moment.duration(moment(unmuteTime).diff(moment())).humanize()}`
					: "") +
				`.`;
			if (ctx.canReply) {
				ctx.reply(content);
			} else {
				ctx.user.createMessage(content);
			}
			ctx.message.delete();
		} else {
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
		}
	}
}

export class UnmuteCommand extends Command {
	private data: Data;

	constructor(commandClient: CommandClient, data: Data) {
		super(commandClient, {
			name: "unmute",
			responseOptional: true,
			disableDm: true,
		} as CommandOptions);

		this.data = data;
	}

	onBefore(ctx: Context): boolean {
		return ctx.member.can(Permissions.MANAGE_ROLES);
	}

	async run(ctx: Context, { unmute: userId }: ParsedArgs): Promise<void> {
		// Find user ID from mention
		userId = userId.match(/<@!?(\d+)>/)?.[1] || userId;

		if (/^\d+$/.test(userId)) {
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
		} else {
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
		}
	}
}
