import { APIEmbed } from "discord.js";
import {
	ApplicationCommandOptionChoice,
	ApplicationCommandType,
	AutocompleteContext,
	CommandContext,
	CommandOptionType,
	MessageOptions,
	SlashCommand,
	SlashCreator,
} from "slash-create";
import { DiscordBot } from "../..";
import { EphemeralResponse } from ".";
import QueryString from "qs";
import axios, { AxiosResponse } from "axios";
import config from "@/config/deepl.json";

const LANG = [
	"BG",
	"CS",
	"DA",
	"DE",
	"EL",
	"EN-GB",
	"EN-US",
	"EN",
	"ES",
	"ET",
	"FI",
	"FR",
	"HU",
	"IT",
	"JA",
	"LT",
	"LV",
	"NL",
	"PL",
	"PT-PT",
	"PT-BR",
	"PT",
	"RO",
	"RU",
	"SK",
	"SL",
	"SV",
	"TR",
	"UK",
	"ZH",
] as const;

type SupportedLanguages = typeof LANG[number];

interface DeeplResponse {
	translations: {
		detected_source_language: string;
		text: string;
	}[];
}
interface DeeplOptions {
	auth_key: string;
	text: string;
	source_lang?: SupportedLanguages;
	target_lang: SupportedLanguages;
	split_sentences?: "0" | "1" | "nonewlines";
	preserve_formatting?: "0" | "1";
	formality?: "default" | "more" | "less" | "prefer_more" | "prefer_less";
	glossary_id?: string;
}

async function translate(options: DeeplOptions): Promise<AxiosResponse<DeeplResponse>> {
	return axios.post("https://api-free.deepl.com/v2/translate", QueryString.stringify(options));
}

export class SlashDeeplCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "deepl",
			description: "translate using DeepL.",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
			options: [
				{
					name: "text",
					description: "text to translate",
					type: CommandOptionType.STRING,
					required: true,
				},
				{
					name: "to",
					description: "language to translate to",
					type: CommandOptionType.STRING,
					autocomplete: true,
				},
				{
					name: "from",
					description: "language to translate to",
					type: CommandOptionType.STRING,
					autocomplete: true,
				},
				{
					name: "formal",
					description:
						"try to get a more formal version if possible for now (DE,FR,IT,ES,NL,PL,PT,RU)",
					type: CommandOptionType.STRING,
					choices: [
						{ name: "more_formal", value: "prefer_more" },
						{ name: "less_formal", value: "prefer_less" },
					],
				},
			],
		});
		this.filePath = __filename;
	}
	async autocomplete(ctx: AutocompleteContext): Promise<any> {
		return LANG.filter(
			function (entry) {
				if (this.limit < 25) {
					this.limit++;
					return entry.includes(ctx.options[ctx.focused]);
				}
			},
			{ limit: 0 }
		).map(lang => {
			return { name: lang, value: lang } as ApplicationCommandOptionChoice;
		});
	}

	async run(ctx: CommandContext): Promise<any> {
		const text = ctx.options.text;
		if (text && Buffer.from(text).length < 128 * 1024) {
			const res = await translate({
				auth_key: config.key,
				text: ctx.options.text,
				target_lang: ctx.options.to ?? "EN",
				source_lang: ctx.options.from,
				formality: ctx.options.formal ? ctx.options.formal : "default",
			});
			if (res) {
				return `**${res.data.translations[0].detected_source_language} -> ${
					ctx.options.to ?? "EN"
				}${
					ctx.options.formal
						? ` (${ctx.options.formal === "prefer_more" ? "formal" : "less formal"})`
						: ""
				}**\`\`\`\n${res.data.translations[0].text}\`\`\``;
			} else {
				return EphemeralResponse("Something went wrong while trying to translate.");
			}
		} else {
			return EphemeralResponse("Text too big!");
		}
	}
}

export class UIDeeplCommand extends SlashCommand {
	constructor(bot: DiscordBot, creator: SlashCreator) {
		super(creator, {
			name: "DeepL translate",
			deferEphemeral: true,
			guildIDs: [bot.config.bot.primaryGuildId],
			type: ApplicationCommandType.MESSAGE,
		});
		this.filePath = __filename;
	}

	async run(ctx: CommandContext): Promise<any> {
		const msg = ctx.targetMessage;
		const text = msg?.content;
		if (text && Buffer.from(text).length < 128 * 1024) {
			const res = await translate({
				auth_key: config.key,
				text: text,
				target_lang: "EN",
			});
			if (res) {
				const embed: APIEmbed = {
					author: {
						name: msg.author.username,
						icon_url: msg.author.avatarURL,
						url: `https://discord.com/channels/${ctx.guildID}/${msg.channelID}/${msg.id}`,
					},
					footer: {
						text: "DeepL translate",
						icon_url: "https://avatars.githubusercontent.com/u/83310993?s=200&v=4",
					},
					description: `
					\`\`\`\n${msg.content}\`\`\`\n**${res.data.translations[0].detected_source_language} -> ${
						ctx.options.to ?? "EN"
					}**\n\`\`\`\n${res.data.translations[0].text}\`\`\``,
				};
				return { embeds: [embed], ephemeral: true } as MessageOptions;
			} else {
				return EphemeralResponse("Something went wrong while trying to translate.");
			}
		} else {
			return EphemeralResponse("Can't find text to translate or text is too big.");
		}
	}
}
