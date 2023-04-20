import {
	AutocompleteChoice,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "@/app/services";
import { EphemeralResponse } from "..";
import { Rule } from "../../..";
import { SlashDeveloperCommand } from "./DeveloperCommand";

export class SlashRuleCommand extends SlashDeveloperCommand {
	private ruleCache: Array<Rule> = [];
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(bot, creator, {
			name: "rule",
			description: "Adds, removes or edits a Rule.",
			options: [
				{
					type: CommandOptionType.SUB_COMMAND,
					name: "add",
					description: "adds a rule",
					options: [
						{
							type: CommandOptionType.STRING,
							name: "title",
							description: "title of the role (Bold Text)",
							required: true,
						},
						{
							type: CommandOptionType.STRING,
							name: "description",
							description: "description of the role",
						},
						{
							type: CommandOptionType.NUMBER,
							name: "position",
							description: "position of the rule",
						},
					],
				},
				{
					type: CommandOptionType.SUB_COMMAND,
					name: "remove",
					description: "remove a rule",
					options: [
						{
							type: CommandOptionType.INTEGER,
							name: "rule",
							description: "Number of the rule",
							required: true,
							autocomplete: true,
						},
					],
				},
				{
					type: CommandOptionType.SUB_COMMAND,
					name: "edit",
					description: "edits a rule",
					options: [
						{
							type: CommandOptionType.INTEGER,
							name: "rule",
							description: "Number of the rule",
							required: true,
							autocomplete: true,
						},
						{
							type: CommandOptionType.STRING,
							name: "title",
							description: "title of the role (Bold Text)",
						},
						{
							type: CommandOptionType.STRING,
							name: "description",
							description: "description of the role",
						},
						{
							type: CommandOptionType.INTEGER,
							name: "position",
							description: "position of the role",
						},
					],
				},
			],
		});

		this.filePath = __filename;
		this.bot = bot;
	}

	async autocomplete(ctx: AutocompleteContext): Promise<AutocompleteChoice[]> {
		if (ctx.focused && ctx.focused == "rule") {
			if (this.ruleCache.length > 0) {
				return this.ruleCache.map((rule, idx) => {
					return {
						name: rule.title,
						value: idx + 1,
					} as AutocompleteChoice;
				});
			} else {
				this.ruleCache = await this.getRules();
				return this.ruleCache.map((rule, idx) => {
					return {
						name: rule.title,
						value: idx + 1,
					} as AutocompleteChoice;
				});
			}
		}
		return [];
	}

	public async runProtected(ctx: CommandContext): Promise<any> {
		this.ruleCache = await this.getRules();
		try {
			switch (ctx.subcommands[0]) {
				case "add":
					return this.addRule(ctx);
				case "remove":
					return this.removeRule(ctx);
				case "edit":
					return this.editRule(ctx);
			}
		} catch (err) {
			EphemeralResponse(err);
		}
	}

	private async refreshRules(): Promise<void> {
		if (this.ruleCache.length === 0) {
			EphemeralResponse("Something went wrong with saving the rules");
			return;
		}
		const channel = this.bot.getTextChannel(this.bot.config.channels.rules);
		if (!channel) return;
		const msgs = await channel.messages.fetch();
		const msg = msgs
			?.filter(
				msg => msg.author.id === this.bot.discord.user?.id && msg.content.includes("rules")
			)
			.first();

		const rules = `# ***__RULES/GUIDELINES__***\n\n${this.ruleCache
			.map((rule, idx) => `**${idx + 1}. ${rule.title}**\n${rule.description ?? ""}\n\n`)
			.join("")}\n***Breaking these rules may result in a ban!***`;

		if (msg) {
			await msg.edit(rules);
		} else {
			await channel.send(rules);
		}
		await this.saveRules(this.ruleCache);
	}
	private async addRule(ctx: CommandContext): Promise<any> {
		const options = ctx.options[ctx.subcommands[0]];
		if ((options.title as string).length === 0) {
			return EphemeralResponse("You must provide a Title!"); // should be handled by discord but who knows
		}
		if (options.position) {
			const exists = this.ruleCache[options.position - 1];
			if (exists) {
				this.ruleCache.splice(options.position - 1, 0, {
					title: options.title,
					description: options.description,
				});
			} else {
				return EphemeralResponse("Rule position is nonsequential!");
			}
		} else {
			this.ruleCache.push({
				title: options.title,
				description: options.description,
			});
		}

		await this.refreshRules();
		return EphemeralResponse("Successfully added the Rule!");
	}
	private async removeRule(ctx: CommandContext): Promise<any> {
		const options = ctx.options[ctx.subcommands[0]];
		if (!this.ruleCache[options.rule - 1]) {
			return EphemeralResponse("That rule doesn't exist?");
		}
		this.ruleCache.splice(options.rule - 1, 1);
		await this.refreshRules();
		return EphemeralResponse("Successfully deleted the Rule!");
	}
	private async editRule(ctx: CommandContext): Promise<any> {
		const options = ctx.options[ctx.subcommands[0]];
		if (Object.keys(options).length === 0) {
			return EphemeralResponse("well... you need to edit something at least!");
		}
		const rule = this.ruleCache[options.rule - 1];
		if (options.position) {
			const exists = this.ruleCache[options.position - 1];
			if (exists) {
				//arr.splice(index + 1, 0, arr.splice(index, 1)[0]);
				this.ruleCache.splice(
					options.position - 1,
					0,
					this.ruleCache.splice(options.rule - 1, 1)[0]
				);
			} else {
				return EphemeralResponse("Rule position is nonsequential!");
			}
		} else {
			this.ruleCache.splice(options.rule - 1, 1, {
				title: options.title ?? rule.title,
				description: options.description ?? rule.description ?? "",
			});
		}

		await this.refreshRules();
		return EphemeralResponse("Successfully updated the Rules!");
	}
}
