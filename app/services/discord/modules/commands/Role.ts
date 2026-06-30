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

			const primaryColor = primary
				? parseInt(primary.replace(/^#+/, ""), 16)
				: role.colors.primaryColor;
			const secondaryColor = secondary
				? parseInt(secondary.replace(/^#+/, ""), 16)
				: undefined;
			const tertiaryColor: number | undefined = options?.holographic ? 0 : undefined;
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
			const type = head.headers["content-type"]?.toString();
			if (!type || !IMG_TYPES.includes(type)) {
				await ctx.followUp(
					EphemeralResponse(
						`invalid image type \`${type}\`\nOnly \`${IMG_TYPES.join(", ")}\` are supported, sorry.`
					)
				);
				return;
			}
			const data = await axios
				.get(reqURL, { responseType: "arraybuffer" })
				.then(response => Buffer.from(response.data));
			await role.setIcon(data);
		} catch {
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
): Promise<void> => {
	const unicode = emoji.match(
		/^(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F)?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier})(?:\u200d(?:\p{RI}\p{RI}|\p{Extended_Pictographic}(?:\uFE0F)?|\p{Emoji_Modifier_Base}\p{Emoji_Modifier}))*$/u
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

const removeRole = async (ctx: Discord.ChatInputCommandInteraction): Promise<void> => {
	const role = (ctx.member as Discord.GuildMember).getCustomRole;
	const member = ctx.member as Discord.GuildMember;
	if (role && member) {
		await member.roles.remove(role, "Removed role via command");
		if (role.members.size === 0) {
			await role.delete("Role has no members anymore");
		}
	}
	if (role) {
		await ctx.followUp(EphemeralResponse("👍"));
	} else {
		await ctx.followUp(EphemeralResponse("You don't have a custom role..."));
	}
};

const setRole = async (ctx: Discord.ChatInputCommandInteraction): Promise<void> => {
	let roleName = ctx.options.getString("name")?.trim() ?? ctx.user.displayName;
	roleName = roleName.substring(0, 1) + ROLE_IDENTIFIER + roleName.substring(1);
	const hex = ctx.options.getString("hex")?.trim();

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
		bot.discord.on("roleUpdate", oldRole => {
			if (
				oldRole.isCustomRole &&
				oldRole.members.size === 0 &&
				Date.now() - oldRole.createdTimestamp > 3600 * 60 // to prevent instant deletion when creating it, maybe there is a better way?
			)
				oldRole.delete("Role is empty...");
		});
	},
};
