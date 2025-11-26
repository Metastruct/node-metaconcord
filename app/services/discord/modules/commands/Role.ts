import * as Discord from "discord.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";
import DiscordConfig from "@/config/discord.json" with { type: "json" };
import axios from "axios";
import { logger } from "@/utils.js";

const log = logger(import.meta);

const ROLE_IDENTIFIER = DiscordConfig.bot.roleIdentifier;
const IMG_TYPES = ["image/png", "image/gif", "image/jpeg"];

const NO_ROLE_RESPONSE =
	"You don't have a custom role yet! Get one with </role add:1140685420565385256>";

const removeRoleIcon = async (ctx: Discord.ChatInputCommandInteraction) => {
	const role = (ctx.member as Discord.GuildMember).getCustomRole;
	if (!role) {
		await ctx.followUp(EphemeralResponse(NO_ROLE_RESPONSE));
		return;
	}
	if (!role.icon && !role.unicodeEmoji) {
		await ctx.followUp(EphemeralResponse("You don't have an icon set!"));
		return;
	}
	await role.setIcon("");
	await role.setUnicodeEmoji("");
	await ctx.followUp(EphemeralResponse("👍"));
};

const setRoleColorSpecial = async (
	ctx: Discord.ChatInputCommandInteraction,
	options?: {
		holographic?: boolean;
		remove?: boolean;
	}
) => {
	const possible = ctx.guild && ctx.guild.features.includes("ENHANCED_ROLE_COLORS");
	if (!possible) {
		await ctx.followUp(
			EphemeralResponse("Sorry we need enhanced role colors to use this feature...")
		);
		return;
	}
	const role = (ctx.member as Discord.GuildMember).getCustomRole;
	if (!role) {
		await ctx.followUp(EphemeralResponse(NO_ROLE_RESPONSE));
		return;
	}
	try {
		let colors: Discord.RoleColorsResolvable = { primaryColor: role.colors.primaryColor };
		let reason: string;
		if (options?.remove) {
			reason = "Removed gradient via command";
		} else {
			const primary = ctx.options.getString("primary_color");
			const secondary = !options?.holographic
				? ctx.options.getString("secondary_color", true)
				: null;

			let primaryColor = primary
				? parseInt(primary.replace(/^#+/, ""), 16)
				: role.colors.primaryColor;
			let secondaryColor = secondary ? parseInt(secondary.replace(/^#+/, ""), 16) : undefined;
			let tertiaryColor: number | undefined = undefined;

			if (options?.holographic) {
				// for some reason only this one has a third colour option and it's static
				primaryColor = 11127295;
				secondaryColor = 16759788;
				tertiaryColor = 16761760;
			}
			colors = {
				primaryColor,
				secondaryColor,
				tertiaryColor,
			};
			reason = "Added/Changed gradient via command";
		}

		await role.setColors(colors, reason);

		await ctx.followUp(
			EphemeralResponse(
				`👍\nhere is your old role color if you want to change back: Primary: \`${role.hexColor}\`${role.colors.secondaryColor ? ` Secondary: ${`#${role.colors.secondaryColor.toString(16).padStart(6, "0")}`}` : ""}${role.colors.tertiaryColor ? ` Tertiary: ${`#${role.colors.tertiaryColor.toString(16).padStart(6, "0")}`}` : ""}`
			)
		);
	} catch (err) {
		log.error(err);
		await ctx.followUp(EphemeralResponse("Something went wrong trying to add the gradient :("));
	}
};

const setRoleIcon = async (ctx: Discord.ChatInputCommandInteraction, download: boolean) => {
	const premiumTier = ctx.guild?.premiumTier;
	if (premiumTier && premiumTier < 2) {
		await ctx.followUp(
			EphemeralResponse("Sorry we need Server Boost Level 2 to use this feature...")
		);
		return;
	}
	const role = (ctx.member as Discord.GuildMember).getCustomRole;
	if (!role) {
		await ctx.followUp(EphemeralResponse(NO_ROLE_RESPONSE));
		return;
	}
	if (download) {
		return await uploadIcon(ctx, role);
	}
	return await setEmoji(ctx, ctx.options.getString("emoji", true), role);
};

const uploadIcon = async (ctx: Discord.ChatInputCommandInteraction, role: Discord.Role) => {
	const attachment = ctx.options.getAttachment("file");
	const url = ctx.options.getString("image_url");
	const reqURL = attachment
		? attachment.url
		: url
			? url.match(/(https?:\/\/.*\.(?:png|jpg))/)?.[0]
			: undefined;

	if (reqURL) {
		try {
			const head = await axios.head(reqURL);
			if (!IMG_TYPES.includes(head.headers["content-type"])) {
				await ctx.followUp(
					EphemeralResponse(
						`invalid image type \`${
							head.headers["content-type"]
						}\`\nOnly \`${IMG_TYPES.join(", ")}\` are supported, sorry.`
					)
				);
				return;
			}
			const data = await axios
				.get(reqURL, { responseType: "arraybuffer" })
				.then(response => Buffer.from(response.data));
			await role.setIcon(data);
		} catch (err) {
			await ctx.followUp(
				EphemeralResponse(
					`could not set role icon :( ${
						reqURL.includes("imgur") ? "Imgur is known to have issues" : ""
					}`
				)
			);
			return;
		}
		await ctx.followUp(EphemeralResponse("👍"));
		return;
	}

	await ctx.followUp(EphemeralResponse("missing file or invalid url"));
};
const setEmoji = async (
	ctx: Discord.ChatInputCommandInteraction,
	emoji: string,
	role: Discord.Role
): Promise<any> => {
	// lmao
	const unicode = emoji.match(
		/(?:\ud83d\udc68\ud83c\udffc\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c\udffb|\ud83d\udc68\ud83c\udffd\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb\udffc]|\ud83d\udc68\ud83c\udffe\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb-\udffd]|\ud83d\udc68\ud83c\udfff\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb-\udffe]|\ud83d\udc69\ud83c\udffb\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffc-\udfff]|\ud83d\udc69\ud83c\udffc\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb\udffd-\udfff]|\ud83d\udc69\ud83c\udffc\u200d\ud83e\udd1d\u200d\ud83d\udc69\ud83c\udffb|\ud83d\udc69\ud83c\udffd\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb\udffc\udffe\udfff]|\ud83d\udc69\ud83c\udffd\u200d\ud83e\udd1d\u200d\ud83d\udc69\ud83c[\udffb\udffc]|\ud83d\udc69\ud83c\udffe\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb-\udffd\udfff]|\ud83d\udc69\ud83c\udffe\u200d\ud83e\udd1d\u200d\ud83d\udc69\ud83c[\udffb-\udffd]|\ud83d\udc69\ud83c\udfff\u200d\ud83e\udd1d\u200d\ud83d\udc68\ud83c[\udffb-\udffe]|\ud83d\udc69\ud83c\udfff\u200d\ud83e\udd1d\u200d\ud83d\udc69\ud83c[\udffb-\udffe]|\ud83e\uddd1\ud83c\udffb\u200d\ud83e\udd1d\u200d\ud83e\uddd1\ud83c\udffb|\ud83e\uddd1\ud83c\udffc\u200d\ud83e\udd1d\u200d\ud83e\uddd1\ud83c[\udffb\udffc]|\ud83e\uddd1\ud83c\udffd\u200d\ud83e\udd1d\u200d\ud83e\uddd1\ud83c[\udffb-\udffd]|\ud83e\uddd1\ud83c\udffe\u200d\ud83e\udd1d\u200d\ud83e\uddd1\ud83c[\udffb-\udffe]|\ud83e\uddd1\ud83c\udfff\u200d\ud83e\udd1d\u200d\ud83e\uddd1\ud83c[\udffb-\udfff]|\ud83e\uddd1\u200d\ud83e\udd1d\u200d\ud83e\uddd1|\ud83d\udc6b\ud83c[\udffb-\udfff]|\ud83d\udc6c\ud83c[\udffb-\udfff]|\ud83d\udc6d\ud83c[\udffb-\udfff]|\ud83d[\udc6b-\udc6d])|(?:\ud83d[\udc68\udc69])(?:\ud83c[\udffb-\udfff])?\u200d(?:\u2695\ufe0f|\u2696\ufe0f|\u2708\ufe0f|\ud83c[\udf3e\udf73\udf93\udfa4\udfa8\udfeb\udfed]|\ud83d[\udcbb\udcbc\udd27\udd2c\ude80\ude92]|\ud83e[\uddaf-\uddb3\uddbc\uddbd])|(?:\ud83c[\udfcb\udfcc]|\ud83d[\udd74\udd75]|\u26f9)((?:\ud83c[\udffb-\udfff]|\ufe0f)\u200d[\u2640\u2642]\ufe0f)|(?:\ud83c[\udfc3\udfc4\udfca]|\ud83d[\udc6e\udc71\udc73\udc77\udc81\udc82\udc86\udc87\ude45-\ude47\ude4b\ude4d\ude4e\udea3\udeb4-\udeb6]|\ud83e[\udd26\udd35\udd37-\udd39\udd3d\udd3e\uddb8\uddb9\uddcd-\uddcf\uddd6-\udddd])(?:\ud83c[\udffb-\udfff])?\u200d[\u2640\u2642]\ufe0f|(?:\ud83d\udc68\u200d\u2764\ufe0f\u200d\ud83d\udc8b\u200d\ud83d\udc68|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\u2764\ufe0f\u200d\ud83d\udc8b\u200d\ud83d[\udc68\udc69]|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\u2764\ufe0f\u200d\ud83d\udc68|\ud83d\udc68\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc68\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc68\u200d\ud83d[\udc66\udc67]|\ud83d\udc68\u200d\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\u2764\ufe0f\u200d\ud83d[\udc68\udc69]|\ud83d\udc69\u200d\ud83d\udc66\u200d\ud83d\udc66|\ud83d\udc69\u200d\ud83d\udc67\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83c\udff3\ufe0f\u200d\ud83c\udf08|\ud83c\udff4\u200d\u2620\ufe0f|\ud83d\udc15\u200d\ud83e\uddba|\ud83d\udc41\u200d\ud83d\udde8|\ud83d\udc68\u200d\ud83d[\udc66\udc67]|\ud83d\udc69\u200d\ud83d[\udc66\udc67]|\ud83d\udc6f\u200d\u2640\ufe0f|\ud83d\udc6f\u200d\u2642\ufe0f|\ud83e\udd3c\u200d\u2640\ufe0f|\ud83e\udd3c\u200d\u2642\ufe0f|\ud83e\uddde\u200d\u2640\ufe0f|\ud83e\uddde\u200d\u2642\ufe0f|\ud83e\udddf\u200d\u2640\ufe0f|\ud83e\udddf\u200d\u2642\ufe0f)|[#*0-9]\ufe0f?\u20e3|(?:[©®\u2122\u265f]\ufe0f)|(?:\ud83c[\udc04\udd70\udd71\udd7e\udd7f\ude02\ude1a\ude2f\ude37\udf21\udf24-\udf2c\udf36\udf7d\udf96\udf97\udf99-\udf9b\udf9e\udf9f\udfcd\udfce\udfd4-\udfdf\udff3\udff5\udff7]|\ud83d[\udc3f\udc41\udcfd\udd49\udd4a\udd6f\udd70\udd73\udd76-\udd79\udd87\udd8a-\udd8d\udda5\udda8\uddb1\uddb2\uddbc\uddc2-\uddc4\uddd1-\uddd3\udddc-\uddde\udde1\udde3\udde8\uddef\uddf3\uddfa\udecb\udecd-\udecf\udee0-\udee5\udee9\udef0\udef3]|[\u203c\u2049\u2139\u2194-\u2199\u21a9\u21aa\u231a\u231b\u2328\u23cf\u23ed-\u23ef\u23f1\u23f2\u23f8-\u23fa\u24c2\u25aa\u25ab\u25b6\u25c0\u25fb-\u25fe\u2600-\u2604\u260e\u2611\u2614\u2615\u2618\u2620\u2622\u2623\u2626\u262a\u262e\u262f\u2638-\u263a\u2640\u2642\u2648-\u2653\u2660\u2663\u2665\u2666\u2668\u267b\u267f\u2692-\u2697\u2699\u269b\u269c\u26a0\u26a1\u26aa\u26ab\u26b0\u26b1\u26bd\u26be\u26c4\u26c5\u26c8\u26cf\u26d1\u26d3\u26d4\u26e9\u26ea\u26f0-\u26f5\u26f8\u26fa\u26fd\u2702\u2708\u2709\u270f\u2712\u2714\u2716\u271d\u2721\u2733\u2734\u2744\u2747\u2757\u2763\u2764\u27a1\u2934\u2935\u2b05-\u2b07\u2b1b\u2b1c\u2b50\u2b55\u3030\u303d\u3297\u3299])(?:\ufe0f|(?!\ufe0e))|(?:(?:\ud83c[\udfcb\udfcc]|\ud83d[\udd74\udd75\udd90]|[\u261d\u26f7\u26f9\u270c\u270d])(?:\ufe0f|(?!\ufe0e))|(?:\ud83c[\udf85\udfc2-\udfc4\udfc7\udfca]|\ud83d[\udc42\udc43\udc46-\udc50\udc66-\udc69\udc6e\udc70-\udc78\udc7c\udc81-\udc83\udc85-\udc87\udcaa\udd7a\udd95\udd96\ude45-\ude47\ude4b-\ude4f\udea3\udeb4-\udeb6\udec0\udecc]|\ud83e[\udd0f\udd18-\udd1c\udd1e\udd1f\udd26\udd30-\udd39\udd3d\udd3e\uddb5\uddb6\uddb8\uddb9\uddbb\uddcd-\uddcf\uddd1-\udddd]|[\u270a\u270b]))(?:\ud83c[\udffb-\udfff])?|(?:\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc65\udb40\udc6e\udb40\udc67\udb40\udc7f|\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc73\udb40\udc63\udb40\udc74\udb40\udc7f|\ud83c\udff4\udb40\udc67\udb40\udc62\udb40\udc77\udb40\udc6c\udb40\udc73\udb40\udc7f|\ud83c\udde6\ud83c[\udde8-\uddec\uddee\uddf1\uddf2\uddf4\uddf6-\uddfa\uddfc\uddfd\uddff]|\ud83c\udde7\ud83c[\udde6\udde7\udde9-\uddef\uddf1-\uddf4\uddf6-\uddf9\uddfb\uddfc\uddfe\uddff]|\ud83c\udde8\ud83c[\udde6\udde8\udde9\uddeb-\uddee\uddf0-\uddf5\uddf7\uddfa-\uddff]|\ud83c\udde9\ud83c[\uddea\uddec\uddef\uddf0\uddf2\uddf4\uddff]|\ud83c\uddea\ud83c[\udde6\udde8\uddea\uddec\udded\uddf7-\uddfa]|\ud83c\uddeb\ud83c[\uddee-\uddf0\uddf2\uddf4\uddf7]|\ud83c\uddec\ud83c[\udde6\udde7\udde9-\uddee\uddf1-\uddf3\uddf5-\uddfa\uddfc\uddfe]|\ud83c\udded\ud83c[\uddf0\uddf2\uddf3\uddf7\uddf9\uddfa]|\ud83c\uddee\ud83c[\udde8-\uddea\uddf1-\uddf4\uddf6-\uddf9]|\ud83c\uddef\ud83c[\uddea\uddf2\uddf4\uddf5]|\ud83c\uddf0\ud83c[\uddea\uddec-\uddee\uddf2\uddf3\uddf5\uddf7\uddfc\uddfe\uddff]|\ud83c\uddf1\ud83c[\udde6-\udde8\uddee\uddf0\uddf7-\uddfb\uddfe]|\ud83c\uddf2\ud83c[\udde6\udde8-\udded\uddf0-\uddff]|\ud83c\uddf3\ud83c[\udde6\udde8\uddea-\uddec\uddee\uddf1\uddf4\uddf5\uddf7\uddfa\uddff]|\ud83c\uddf4\ud83c\uddf2|\ud83c\uddf5\ud83c[\udde6\uddea-\udded\uddf0-\uddf3\uddf7-\uddf9\uddfc\uddfe]|\ud83c\uddf6\ud83c\udde6|\ud83c\uddf7\ud83c[\uddea\uddf4\uddf8\uddfa\uddfc]|\ud83c\uddf8\ud83c[\udde6-\uddea\uddec-\uddf4\uddf7-\uddf9\uddfb\uddfd-\uddff]|\ud83c\uddf9\ud83c[\udde6\udde8\udde9\uddeb-\udded\uddef-\uddf4\uddf7\uddf9\uddfb\uddfc\uddff]|\ud83c\uddfa\ud83c[\udde6\uddec\uddf2\uddf3\uddf8\uddfe\uddff]|\ud83c\uddfb\ud83c[\udde6\udde8\uddea\uddec\uddee\uddf3\uddfa]|\ud83c\uddfc\ud83c[\uddeb\uddf8]|\ud83c\uddfd\ud83c\uddf0|\ud83c\uddfe\ud83c[\uddea\uddf9]|\ud83c\uddff\ud83c[\udde6\uddf2\uddfc]|\ud83c[\udccf\udd8e\udd91-\udd9a\udde6-\uddff\ude01\ude32-\ude36\ude38-\ude3a\ude50\ude51\udf00-\udf20\udf2d-\udf35\udf37-\udf7c\udf7e-\udf84\udf86-\udf93\udfa0-\udfc1\udfc5\udfc6\udfc8\udfc9\udfcf-\udfd3\udfe0-\udff0\udff4\udff8-\udfff]|\ud83d[\udc00-\udc3e\udc40\udc44\udc45\udc51-\udc65\udc6a-\udc6d\udc6f\udc79-\udc7b\udc7d-\udc80\udc84\udc88-\udca9\udcab-\udcfc\udcff-\udd3d\udd4b-\udd4e\udd50-\udd67\udda4\uddfb-\ude44\ude48-\ude4a\ude80-\udea2\udea4-\udeb3\udeb7-\udebf\udec1-\udec5\uded0-\uded2\uded5\udeeb\udeec\udef4-\udefa\udfe0-\udfeb]|\ud83e[\udd0d\udd0e\udd10-\udd17\udd1d\udd20-\udd25\udd27-\udd2f\udd3a\udd3c\udd3f-\udd45\udd47-\udd71\udd73-\udd76\udd7a-\udda2\udda5-\uddaa\uddae-\uddb4\uddb7\uddba\uddbc-\uddca\uddd0\uddde-\uddff\ude70-\ude73\ude78-\ude7a\ude80-\ude82\ude90-\ude95]|[\u23e9-\u23ec\u23f0\u23f3\u267e\u26ce\u2705\u2728\u274c\u274e\u2753-\u2755\u2795-\u2797\u27b0\u27bf\ue50a])|\ufe0f/g
	);
	const custom = emoji.match(/<?(a)?:?(\w{2,32}):(\d{17,19})>?$/);

	if (unicode) {
		const emoji = unicode[0];
		await role.setUnicodeEmoji(emoji);
		await ctx.followUp(EphemeralResponse("👍"));
		return;
	}
	if (custom) {
		let emoji: string | Buffer | undefined = ctx.client.emojis.resolve(custom[3])?.url;
		if (!emoji) {
			try {
				const data = await axios
					.get(`https://cdn.discordapp.com/emojis/${custom[3]}.png`, {
						responseType: "arraybuffer",
					})
					.then(response => Buffer.from(response.data));
				emoji = data;
			} catch (error) {
				await ctx.followUp(
					EphemeralResponse(`Couldn't get your emote for some reason 🤷‍♂️\n${error}`)
				);
				return;
			}
		}
		await role.setIcon(emoji);
		await ctx.followUp(EphemeralResponse("👍"));
		return;
	}
	await ctx.followUp(EphemeralResponse("that doesn't seem to be a vaild emoji 🤔"));
};

const removeRole = async (ctx: Discord.ChatInputCommandInteraction): Promise<any> => {
	const role = (ctx.member as Discord.GuildMember).getCustomRole;
	const member = ctx.member as Discord.GuildMember;
	if (role && member) {
		await member.roles.remove(role, "Removed role via command");
		if (role.members.size === 0) {
			await role.delete("Role has no members anymore");
		}
	}
	role
		? await ctx.followUp(EphemeralResponse("👍"))
		: await ctx.followUp(EphemeralResponse("You don't have a custom role..."));
};

const setRole = async (ctx: Discord.ChatInputCommandInteraction): Promise<any> => {
	let roleName = ctx.options.getString("name") ?? ctx.user.displayName;
	roleName = roleName.substring(0, 1) + ROLE_IDENTIFIER + roleName.substring(1);
	const hex = ctx.options.getString("hex");

	const guild = ctx.guild;
	if (!guild) {
		await ctx.followUp(EphemeralResponse("Not in a guild"));
		return;
	}

	const roles = guild.roles;
	const member = ctx.member as Discord.GuildMember;
	const customRole = member.getCustomRole;

	// if a colour is defined replace it. Otherwise fall back to the existing one (to change the name only) or get a random one
	const roleColor: Discord.ColorResolvable = hex
		? parseInt(hex.replace(/^#+/, ""), 16)
		: customRole
			? customRole.colors.primaryColor
			: "Random";

	let targetRole = roles.cache.find((r: { name: string }) => r.name === roleName);
	if (!targetRole) {
		// if we have an another existing role, remove it instead of renaming to prevent hijacking
		if (customRole) {
			await member.roles.remove(customRole);
			if (customRole.members.size === 0) {
				await customRole.delete("role name changed, deleting old empty role");
			}
		}

		const boosterRole = await guild.roles.fetch(DiscordConfig.roles.serverbooster);

		targetRole = await roles.create({
			reason: "Added role via command",
			name: roleName.toString(),
			colors: { primaryColor: roleColor },
			position: boosterRole ? boosterRole?.position + 1 : 2,
		});
	} else {
		try {
			await targetRole.setColors(
				{ primaryColor: roleColor },
				"Updated role color via command"
			);
		} catch (err) {
			log.error(err);
			await ctx.followUp(
				EphemeralResponse("Something went wrong changing the color of the role :(")
			);
			return;
		}
	}

	await member.roles.add(targetRole);
	await ctx.followUp(EphemeralResponse("👍"));
};

export const SlashRoleCommand: SlashCommand = {
	options: {
		name: "role",
		description: "Gives you a Custom Role.",
		options: [
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "add",
				description: "Adds a custom role",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "name",
						description: "The name of your role",
						required: true,
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "hex",
						description: "Hex color for the role for example #465f83",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "set_color",
				description: "Changes the custom role color",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "hex",
						description: "Hex color for the role example #465f83",
						required: true,
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "remove",
				description: "Removes your custom role",
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "set_gradient",
				description: "Adds a secondary color to make a gradient, if it's unlocked.",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "secondary_color",
						description: "Hex color for the end example #465f83",
						required: true,
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "primary_color",
						description: "Hex color for the start example #465f83",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "set_holographic",
				description: "Sets the role color to holographic, if it's unlocked.",
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "remove_gradient",
				description: "Sets your role color back to a single color.",
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "set_icon",
				description: "adds a custom icon to your role",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "image_url",
						description: "the url for your role, please try to use a small image",
					},
					{
						name: "file",
						type: Discord.ApplicationCommandOptionType.Attachment,
						description: "image file",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "set_emoji",
				description: "adds an emoji to your role",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "emoji",
						description: "the emoji you want to add to your role",
						required: true,
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "remove_icon",
				description: "Removes your custom icon",
			},
		],
	},
	execute: async ctx => {
		await ctx.deferReply({ flags: Discord.MessageFlags.Ephemeral });
		const cmd = ctx.options.getSubcommand();
		try {
			switch (cmd) {
				case "add":
				case "set_color":
					await setRole(ctx);
					break;
				case "remove":
					await removeRole(ctx);
					break;
				case "set_gradient":
					await setRoleColorSpecial(ctx);
					break;
				case "set_holographic":
					await setRoleColorSpecial(ctx, { holographic: true });
					break;
				case "remove_gradient":
					await setRoleColorSpecial(ctx, { remove: true });
					break;
				case "set_emoji":
					await setRoleIcon(ctx, false);
					break;
				case "set_icon":
					await setRoleIcon(ctx, true);
					break;
				case "remove_icon":
					await removeRoleIcon(ctx);
					break;
			}
		} catch (err) {
			log.error(err);
			await ctx.followUp(
				EphemeralResponse(`Something went wrong adding your role :(\n` + err)
			);
		}
	},
	initialize: async bot => {
		bot.discord.on("guildMemberRemove", async member => {
			const role = member.getCustomRole;
			if (role) role.delete("User left the Guild...");
		});
		bot.discord.on("roleUpdate", (oldRole, newRole) => {
			if (
				oldRole.isCustomRole &&
				oldRole.members.size === 0 &&
				Date.now() - oldRole.createdTimestamp > 3600 * 60 // to prevent instant deletion when creating it, maybe there is a better way?
			)
				oldRole.delete("Role empty...");
		});
	},
};
