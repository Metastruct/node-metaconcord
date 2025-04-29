import * as Discord from "discord.js";
import { DiscordBot, Rule } from "@/app/services/discord/index.js";
import { EphemeralResponse, SlashCommand } from "@/extensions/discord.js";

let ruleCache: Rule[] = [];

const refreshRules = async (ctx: Discord.ChatInputCommandInteraction, bot: DiscordBot) => {
	const data = await bot.container.getService("Data");
	if (ruleCache.length === 0) {
		await ctx.reply(EphemeralResponse("Something went wrong with saving the rules"));
		return;
	}
	const editOnly = ctx.options.getBoolean("edit_only") ?? false;
	const channel = bot.getTextChannel(bot.config.channels.rules);
	if (!channel) return;
	const msgs = await channel.messages.fetch();
	const msg = msgs
		?.filter(msg => msg.author.id === bot.discord.user?.id && msg.content.includes("rules"))
		.first();

	const rules = `# ***__RULES/GUIDELINES__***\n\n\n${ruleCache
		.map((rule, idx) => `**${idx + 1}. ${rule.title}**\n${rule.description ?? ""}\n\n`)
		.join("")}\n# ***Breaking these rules may result in a ban!***`;

	if (msg) {
		if (editOnly) {
			await msg.edit(rules);
		} else {
			await msg.delete();
		}
	}
	if (!editOnly) {
		await channel.send(rules);
	}
	data.rules = ruleCache;
	await data.save();
};

const addRule = async (ctx: Discord.ChatInputCommandInteraction, bot: DiscordBot) => {
	const title = ctx.options.getString("title", true);
	const position = ctx.options.getNumber("position");
	const description = ctx.options.getString("description") ?? undefined;
	if (title.length === 0) {
		await ctx.reply(EphemeralResponse("You must provide a Title!")); // should be handled by discord but who knows
		return;
	}
	if (position) {
		const exists = ruleCache[position - 1];
		if (exists) {
			ruleCache.splice(position - 1, 0, {
				title: title,
				description: description,
			});
		} else {
			await ctx.reply(
				EphemeralResponse(
					`Rule ${position} does not exist.\nUse add without a position to append a new rule.`
				)
			);
			return;
		}
	} else {
		ruleCache.push({
			title: title,
			description: description,
		});
	}

	await refreshRules(ctx, bot);
	await ctx.reply("Successfully added the Rule!");
};
const removeRule = async (ctx: Discord.ChatInputCommandInteraction, bot: DiscordBot) => {
	const rule = ctx.options.getInteger("rule", true);
	if (!ruleCache[rule - 1]) {
		await ctx.reply(EphemeralResponse("That rule doesn't exist?"));
		return;
	}
	ruleCache.splice(rule - 1, 1);
	await refreshRules(ctx, bot);
	await ctx.reply("Successfully deleted the Rule!");
};

const editRule = async (ctx: Discord.ChatInputCommandInteraction, bot: DiscordBot) => {
	const title = ctx.options.getString("title", true);
	const position = ctx.options.getNumber("position");
	const description = ctx.options.getString("description") ?? undefined;

	if (!title && !position && !description) {
		await ctx.reply(EphemeralResponse("well... you need to edit something at least!"));
		return;
	}
	const choosenRule = ctx.options.getInteger("rule", true);
	const rule = ruleCache[choosenRule - 1];
	if (position) {
		const exists = ruleCache[position - 1];
		if (exists) {
			//arr.splice(index + 1, 0, arr.splice(index, 1)[0]);
			ruleCache.splice(position - 1, 0, ruleCache.splice(choosenRule - 1, 1)[0]);
		} else {
			await ctx.reply(EphemeralResponse(`Rule ${position} does not exist.`));
			return;
		}
	} else {
		ruleCache.splice(choosenRule - 1, 1, {
			title: title ?? rule.title,
			description: description ?? rule.description ?? "",
		});
	}

	await refreshRules(ctx, bot);
	await ctx.reply("Successfully updated the Rules!");
};

export const SlashRuleCommand: SlashCommand = {
	options: {
		name: "rule",
		description: "Adds, removes or edits a Rule.",
		default_member_permissions: Discord.PermissionsBitField.Flags.ManageGuild.toString(),
		options: [
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "add",
				description: "adds a rule",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "title",
						description: "title of the role (Bold Text)",
						required: true,
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "description",
						description: "description of the role",
					},
					{
						type: Discord.ApplicationCommandOptionType.Number,
						name: "position",
						description: "position of the rule",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "edit_only",
						description: "only edit, don't repost",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "remove",
				description: "remove a rule",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "rule",
						description: "Number of the rule",
						required: true,
						autocomplete: true,
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "edit_only",
						description: "only edit, don't repost",
					},
				],
			},
			{
				type: Discord.ApplicationCommandOptionType.Subcommand,
				name: "edit",
				description: "edits a rule",
				options: [
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "rule",
						description: "Number of the rule",
						required: true,
						autocomplete: true,
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "title",
						description: "title of the role (Bold Text)",
					},
					{
						type: Discord.ApplicationCommandOptionType.String,
						name: "description",
						description: "description of the role",
					},
					{
						type: Discord.ApplicationCommandOptionType.Integer,
						name: "position",
						description: "position of the role",
					},
					{
						type: Discord.ApplicationCommandOptionType.Boolean,
						name: "edit_only",
						description: "only edit, don't repost",
					},
				],
			},
		],
	},

	async execute(ctx, bot) {
		try {
			switch (ctx.options.getSubcommand(true)) {
				case "add":
					await addRule(ctx, bot);
				case "remove":
					await removeRule(ctx, bot);
				case "edit":
					await editRule(ctx, bot);
			}
		} catch (err) {
			ctx.reply(EphemeralResponse(err));
		}
	},
	async autocomplete(ctx, bot) {
		const focused = ctx.options.getFocused();
		if (focused === "rule") {
			await ctx.respond(
				ruleCache.map((rule, idx) => {
					return {
						name: rule.title,
						value: idx + 1,
					};
				})
			);
		} else {
			const data = await bot.container.getService("Data");
			ruleCache = data.rules;
			await ctx.respond(
				ruleCache.map((rule, idx) => {
					return {
						name: rule.title,
						value: idx + 1,
					};
				})
			);
		}
	},
};
