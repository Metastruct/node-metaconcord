import { EphemeralResponse } from ".";
import { SlashCommand } from "@/extensions/discord";
import Discord from "discord.js";
import SteamID from "steamid";

export const SlashWhyBanCommand: SlashCommand = {
	options: {
		name: "whyban",
		description: "Display in-game ban information",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.String,
				name: "query",
				description:
					"use autocomplete or input STEAM_0:1:18717664, [U:1:37435329], 76561197997701057",
				required: true,
				autocomplete: true,
			},
		],
	},

	async execute(ctx, bot) {
		await ctx.deferReply({ ephemeral: true });
		const banService = await bot.container.getService("Bans");
		const ban = await banService.getBan(ctx.options.getString("query", true));
		if (!ban) {
			ctx.followUp(EphemeralResponse("That SteamID has never been banned before."));
			return;
		}
		const banner = await (
			await bot.container.getService("Steam")
		).getUserSummaries(ban.bannersid);

		if (!ban.b) {
			ctx.followUp(
				EphemeralResponse(
					`\`\`\`ansi\n\u001b[1;33m${
						ban.name
					}\u001b[0;0m is currently \u001b[0;32mnot banned\u001b[0;0m but was banned${
						ban.numbans && ban.numbans > 1 ? ` ${ban.numbans} times` : ""
					}\u001b[0;0m before \u001b[4;36m${
						ban.gamemode ? `on ${ban.gamemode}` : "globally"
					}\u001b[0;0m.\nLast ban reason:\n\u001b[0;40m${ban.banreason.replaceAll(
						"```",
						"​`​`​`"
					)}\u001b[0;0m\`\`\``
				)
			);
		} else {
			ctx.followUp(
				EphemeralResponse(
					`\`\`\`ansi\n\u001b[1;33m${
						ban.name
					}\u001b[0;0m is currently \u001b[0;31mbanned\u001b[0;0m by \u001b[1;33m${
						banner ? `${banner.personaname} ` : ""
					}(${ban.bannersid})\u001b[0;0m ${`\u001b[4;36m${
						ban.gamemode ? `on ${ban.gamemode}` : "globally"
					}`}\u001b[0;0m for:\n\u001b[0;40m${ban.banreason.replaceAll(
						"```",
						"​`​`​`"
					)}\u001b[0;0m\`\`\`expires: <t:${ban.whenunban}:R>${
						ban.numbans && ban.numbans > 1
							? `\n\`${ban.name}\` has been banned \`${ban.numbans} times\` so far`
							: ""
					}`
				)
			);
		}
	},

	async autocomplete(ctx, bot) {
		const banService = await bot.container.getService("Bans");
		const list = await banService.getBanList();
		if (!list) {
			ctx.respond([]);
			return;
		}
		await ctx.respond(
			list
				.filter(
					function (ban) {
						if (this.limit < 25) {
							const name = ban.name.toLowerCase().includes(ctx.options.getFocused());
							const sid = new SteamID(ban.sid);
							const sid2 = sid
								.getSteam2RenderedID()
								.includes(ctx.options.getFocused().toUpperCase());
							const sid3 = sid
								.getSteam3RenderedID()
								.includes(ctx.options.getFocused().toUpperCase());
							const sid64 = sid.getSteamID64().includes(ctx.options.getFocused());
							const res = name || sid2 || sid64 || sid3;
							if (!res) return false;
							this.limit++;
							return res;
						}
					},
					{ limit: 0 }
				)
				.map(ban => {
					const namefix = ban.name.replace(/(\u180C|\u0020)/g, ""); // that one ban I swear on me mum is driving me insane
					return {
						name: `${ban.sid} (${namefix.length > 0 ? namefix : "invalid name"})`,
						value: ban.sid,
					};
				})
		);
	},
};
