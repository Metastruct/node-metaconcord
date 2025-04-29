import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
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
		await ctx.deferReply({ flags: Discord.MessageFlags.Ephemeral });
		const banService = await bot.container.getService("Bans");
		const ban = await banService.getBan(ctx.options.getString("query", true));
		if (!ban) {
			await ctx.followUp(EphemeralResponse("That SteamID has never been banned before."));
			return;
		}

		const steam = await bot.container.getService("Steam");

		const banner = await steam.getUserSummaries(ban.bannersid);

		const banned = await steam.getUserSummaries(ban.sid);

		const unbanned = ban.unbannersid
			? await steam.getUserSummaries(ban.unbannersid)
			: undefined;

		const embed = new Discord.EmbedBuilder();

		const bannerAvatar = banner?.avatarfull;
		let bannerName = banner?.personaname ?? ban.bannersid;
		let bannerMention = "";

		// const unbannerAvatar = unbanned?.avatarfull;
		let unbannerName = unbanned?.personaname ?? ban.unbannersid;
		let unbannerMention = "";

		const bannedAvatar = banned?.avatarfull;
		const bannedName = `${ban.name}${
			ban.name !== banned?.personaname ? ` (${banned?.personaname})` : ""
		}`;

		if (bannerName.startsWith("Discord")) {
			const [name, mention] = bannerName
				.replaceAll("Discord ", "")
				.replaceAll(")", "")
				.replaceAll("(", "")
				.split("|")
				.map(x => x.trim());

			bannerName = name;
			bannerMention = mention;
		}

		if (unbannerName && unbannerName.startsWith("Discord")) {
			const [name, mention] = unbannerName
				.replaceAll("Discord ", "")
				.replaceAll(")", "")
				.replaceAll("(", "")
				.split("|")
				.map(x => x.trim());

			unbannerName = name;
			unbannerMention = mention;
		}

		if (bannedAvatar) {
			embed.setThumbnail(bannedAvatar);
		}

		if (bannerMention) {
			embed.addFields({
				name: "Mention",
				value: bannerMention,
			});
		}

		embed.setColor(ban.b ? "Red" : "Green").addFields(
			{
				name: "Nick",
				value: bannedName,
				inline: true,
			},
			{
				name: "Expiration",
				value: ban.whenunban ? `<t:${ban.whenunban}:R>` : "N/A",
				inline: true,
			},
			{
				name: "Reason",
				value: ban.banreason.replaceAll("```", "​`​`​`"),
			},
			{
				name: "Gamemode",
				value: ban.gamemode ? ban.gamemode : "GLOBAL",
			},
			{
				name: "SteamID",
				value: `[${ban.sid}](https://steamcommunity.com/profiles/${ban.sid})`,
			},
			{
				name: "Times banned",
				value: ban.numbans?.toString() ?? "1",
			}
		);

		if (bannerAvatar) {
			embed.setAuthor({
				name: `${bannerName} has banned`,
				iconURL: bannerAvatar,
				url: `https://steamcommunity.com/profiles/${ban.bannersid}`,
			});
		} else {
			embed.setAuthor({
				name: `${bannerName} has banned`,
			});
		}

		if (unbannerName) {
			embed.addFields({
				name: "Unbanned by",
				value: unbannerName ?? "??",
			});

			if (unbannerMention) {
				embed.addFields({
					name: "Mention",
					value: unbannerMention,
				});
			}

			embed.addFields({
				name: "Unban reason",
				value: ban.unbanreason ?? "No Reason",
			});
		}

		await ctx.followUp({ embeds: [embed], flags: Discord.MessageFlags.Ephemeral });
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
